//! The native side of the differential test (`scripts/check-differential.mjs`).
//!
//! Reads JSON lines on standard input: first the profile, as the TypeScript wrapper passes it to
//! the bindings, then one case per line. For each case it prints one line of compact JSON: what
//! these bindings compute natively, with the same inputs the wrapper hands the WebAssembly build.
//! The script runs every case through the wrapper and the WebAssembly build too, and requires the
//! same lines byte for byte.
//!
//! ```sh
//! cargo run --release --example differential --features fixed-aux < cases.jsonl
//! ```
//!
//! Cases (`kind`): `phrase` (an account from a recovery phrase), `legacy` (a legacy passphrase key
//! and a message signature), `amount` (parsing and formatting), `address` (a check against the
//! profile's network), `transfer` and `vote` (a draft, signed). Signatures use the case's fixed
//! auxiliary bytes.

use std::io::{self, BufRead, Write};

use iceroot_sdk_wasm::{
    BindingError, ChainHandle, DraftHandle, KeyHandle, ProfileHandle, format_amount, parse_address,
    parse_amount,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const CONFIGURATION: &str = include_str!("devnet-configuration.json");

type Failure = Box<dyn std::error::Error>;

/// A binding error where the case cannot go on: the test fails.
fn fatal(error: BindingError) -> Failure {
    format!("{}: {}", error.code(), error.message()).into()
}

fn error(error: &BindingError) -> Value {
    json!({ "error": { "code": error.code(), "details": error.details() } })
}

fn text<'a>(case: &'a Value, key: &str) -> Result<&'a str, Failure> {
    case[key]
        .as_str()
        .ok_or_else(|| format!("the case has no text {key}").into())
}

fn number(case: &Value, key: &str) -> Result<u32, Failure> {
    let value = case[key]
        .as_u64()
        .ok_or_else(|| format!("the case has no number {key}"))?;
    Ok(u32::try_from(value)?)
}

fn aux(case: &Value) -> Result<Vec<u8>, Failure> {
    Ok(hex::decode(text(case, "aux")?)?)
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn phrase(profile: &ProfileHandle, case: &Value) -> Result<Value, Failure> {
    let key = KeyHandle::from_phrase(
        profile,
        text(case, "phrase")?.to_owned(),
        number(case, "account")?,
        number(case, "index")?,
        text(case, "passphrase")?.to_owned(),
    );
    Ok(match key {
        Ok(key) => json!({
            "publicKey": hex::encode(key.public_key().map_err(fatal)?),
            "address": key.address().map_err(fatal)?,
            "path": key.path(),
        }),
        Err(failure) => error(&failure),
    })
}

fn legacy(profile: &ProfileHandle, case: &Value) -> Result<Value, Failure> {
    let key = match KeyHandle::from_legacy_passphrase(profile, text(case, "passphrase")?.to_owned())
    {
        Ok(key) => key,
        Err(failure) => return Ok(error(&failure)),
    };
    let signed: Value = serde_json::from_str(
        &key.sign_message_with_aux(text(case, "message")?.as_bytes(), &aux(case)?)
            .map_err(fatal)?,
    )?;
    Ok(json!({
        "publicKey": hex::encode(key.public_key().map_err(fatal)?),
        "address": key.address().map_err(fatal)?,
        "signature": signed["signature"],
    }))
}

fn amount(case: &Value) -> Result<Value, Failure> {
    let decimals = u8::try_from(number(case, "decimals")?)?;
    let parsed = match parse_amount(text(case, "text")?, decimals) {
        Ok(units) => json!(units),
        Err(failure) => error(&failure),
    };
    let max_fraction = match &case["maxFraction"] {
        Value::Null => None,
        value => Some(u8::try_from(value.as_u64().ok_or("maxFraction")?)?),
    };
    let grouping = case["grouping"].as_bool().ok_or("grouping")?;
    let formatted = match format_amount(text(case, "units")?, decimals, max_fraction, grouping) {
        Ok(text) => json!(text),
        Err(failure) => error(&failure),
    };
    Ok(json!({ "parsed": parsed, "formatted": formatted }))
}

fn address(profile: &ProfileHandle, case: &Value) -> Result<Value, Failure> {
    Ok(match parse_address(text(case, "text")?, profile) {
        Ok(bytes) => json!({ "bytes": hex::encode(bytes) }),
        Err(failure) => error(&failure),
    })
}

/// A draft of the case's request by its signer, signed with the case's auxiliary bytes (and by
/// its second signer, when it has one).
fn draft(profile: &ProfileHandle, chain: &ChainHandle, case: &Value) -> Result<Value, Failure> {
    let signer = KeyHandle::from_legacy_passphrase(profile, text(case, "signer")?.to_owned())
        .map_err(fatal)?;
    let second = match case["secondSigner"].as_str() {
        Some(passphrase) => {
            Some(KeyHandle::from_legacy_passphrase(profile, passphrase.to_owned()).map_err(fatal)?)
        }
        None => None,
    };
    let facts = json!({
        "sender": hex::encode(signer.public_key().map_err(fatal)?),
        "nonce": case["nonce"],
        "height": case["height"],
        "secondKey": match &second {
            Some(key) => json!(hex::encode(key.public_key().map_err(fatal)?)),
            None => Value::Null,
        },
    });
    let built = DraftHandle::build(
        chain,
        &case["request"].to_string(),
        &facts.to_string(),
        None,
    );
    let draft = match built {
        Ok(draft) => draft,
        Err(failure) => return Ok(error(&failure)),
    };
    let signed = match &second {
        Some(second) => draft.sign_with_second_aux(&signer, second, &aux(case)?),
        None => draft.sign_with_aux(&signer, &aux(case)?),
    };
    let summary: Value = serde_json::from_str(&draft.summary())?;
    Ok(match signed {
        Ok(signed) => json!({
            "unsigned": sha256_hex(&draft.unsigned_bytes()),
            "size": summary["size"],
            "fee": summary["fee"]["amount"],
            "id": signed.id(),
            "bytes": sha256_hex(&signed.bytes()),
        }),
        Err(failure) => error(&failure),
    })
}

fn main() -> Result<(), Failure> {
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let profile = ProfileHandle::from_json(&lines.next().ok_or("no profile")??).map_err(fatal)?;
    let chain = ChainHandle::load(&profile, CONFIGURATION).map_err(fatal)?;
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    for line in lines {
        let case: Value = serde_json::from_str(&line?)?;
        let result = match text(&case, "kind")? {
            "phrase" => phrase(&profile, &case)?,
            "legacy" => legacy(&profile, &case)?,
            "amount" => amount(&case)?,
            "address" => address(&profile, &case)?,
            "transfer" | "vote" => draft(&profile, &chain, &case)?,
            other => return Err(format!("no case kind {other}").into()),
        };
        writeln!(out, "{}", serde_json::to_string(&result)?)?;
    }
    out.flush()?;
    Ok(())
}
