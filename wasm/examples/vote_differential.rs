//! The native side of the vote library's differential test (`scripts/check-differential.mjs`).
//!
//! Reads one case per line on standard input: a vote snapshot, a selection request, a newer
//! snapshot, a mode to evaluate by, a vote to validate and names to split, in the JSON the
//! TypeScript wrapper passes to the bindings. For each case it prints one line: the SHA-256 of each
//! result in canonical JSON (object keys sorted), or of the error's code and details. The script
//! runs every case through the wrapper and the WebAssembly build too, and requires the same lines.
//!
//! ```sh
//! cargo run --release --example vote_differential --features fixed-aux < cases.jsonl
//! ```

use std::io::{self, BufRead, Write};

use iceroot_sdk_wasm::{BindingError, vote_call};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

type Failure = Box<dyn std::error::Error>;

/// `value` with every object's keys sorted, as the script writes it.
fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys: Vec<&String> = object.keys().collect();
            keys.sort();
            let mut sorted = Map::new();
            for key in keys {
                sorted.insert(key.clone(), canonical(&object[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

/// The SHA-256 of `value` in canonical JSON, or the canonical JSON itself when
/// `VOTE_DIFFERENTIAL_FULL` is set, for looking into a difference.
fn digest(value: &Value) -> String {
    let text = canonical(value).to_string();
    if std::env::var_os("VOTE_DIFFERENTIAL_FULL").is_some() {
        return text;
    }
    hex::encode(Sha256::digest(text.as_bytes()))
}

/// The result of a call in the script's form: its JSON, or `{ error: { code, details } }`.
fn outcome(result: &Result<String, BindingError>) -> Result<Value, Failure> {
    Ok(match result {
        Ok(text) => serde_json::from_str(text)?,
        Err(error) => json!({ "error": { "code": error.code(), "details": error.details() } }),
    })
}

fn text(value: &Value) -> String {
    value.to_string()
}

fn run(case: &Value) -> Result<Value, Failure> {
    let snapshot = text(&case["snapshot"]);
    let selected = vote_call("select", &snapshot, &text(&case["request"]), "");
    let checked = match &selected {
        Ok(selection) => outcome(&vote_call("check", selection, &text(&case["newer"]), ""))?,
        Err(_) => Value::Null,
    };
    let evaluated = vote_call(
        "evaluate",
        &snapshot,
        case["evaluate"].as_str().unwrap_or_default(),
        "",
    );
    let validate = &case["validate"];
    let validated = vote_call(
        "validate",
        &text(&validate["entries"]),
        &text(&validate["rules"]),
        validate["voter"].as_str().unwrap_or_default(),
    );
    let split = vote_call("split", &text(&case["split"]), "", "");
    let selection = outcome(&selected)?;
    let code = selection["error"]["code"]
        .as_str()
        .unwrap_or("ok")
        .to_owned();
    Ok(json!({
        "select": code,
        "selection": digest(&selection),
        "check": digest(&checked),
        "evaluate": digest(&outcome(&evaluated)?),
        "validate": digest(&outcome(&validated)?),
        "split": digest(&outcome(&split)?),
    }))
}

fn main() -> Result<(), Failure> {
    let stdin = io::stdin();
    let mut out = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let case: Value = serde_json::from_str(&line?)?;
        writeln!(out, "{}", run(&case)?)?;
    }
    out.flush()?;
    Ok(())
}
