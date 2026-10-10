//! Prints the native Rust results that every JavaScript context must reproduce byte for byte.
//!
//! ```sh
//! cargo run --example vectors --features fixed-aux > ../test/vectors/wasm-native.json
//! ```
//!
//! Everything is computed natively with the SDK's Rust core (`iceroot-sdk`), not through the
//! bindings, so the file is a native reference for the WebAssembly build: keys from legacy
//! passphrases and from recovery phrases, addresses and their checks, message signatures, phrase
//! checks, amounts, and drafts of every operation with their signed transactions, one of them at
//! the exact fee floor. The transaction requests are written here from the core's own values, in
//! the JSON the wrapper passes, so the bindings' reading of them is checked too. The vote library's
//! selections of a small snapshot in every mode, and a keystore of the SDK's keystore vectors with
//! the recovery phrase it holds, complete the file.

use iceroot_sdk::amount::FormatOptions;
use iceroot_sdk::fee::FeeChoice;
use iceroot_sdk::keys::{Account, AccountOptions, KeyOrigin};
use iceroot_sdk::message;
use iceroot_sdk::phrase::Mnemonic;
use iceroot_sdk::profile::DevnetOptions;
use iceroot_sdk::transaction::{DraftRequest, Operation, Recipient, Resignation, VoteEntry};
use iceroot_sdk::{Address, Amount, Aux, Chain, Draft, Error, OnlineFacts, Profile, PublicKey};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const RELAY: &str = "http://127.0.0.1:4003/api";

const PASSPHRASES: &[&str] = &[
    "probe passphrase",
    "abandon ability able about above absent absorb abstract absurd abuse access accident",
    "",
    "IceRoot \u{2713} \u{51b0}\u{6839} passphrase",
    "  leading and trailing spaces  ",
];

const NETWORKS: &[u8] = &[90, 30, 63];

const MESSAGES: &[&str] = &[
    "IceRoot sign-in test",
    "",
    // Exactly 32 bytes: hashed like any other message, never signed as given.
    "0123456789abcdef0123456789abcdef",
    "example.com wants you to sign in with your IceRoot account:\nURI: https://example.com/login",
    "Gr\u{fc}\u{df}e \u{2713}",
];

/// A recovery phrase, the accounts and indexes derived from it, and the optional BIP39
/// passphrase.
type PhraseCase = (&'static str, &'static [(u32, u32)], &'static str);

/// Recovery phrases of 24, 21 and 18 words.
const PHRASES: &[PhraseCase] = &[
    (
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
        &[(0, 0), (0, 1), (1, 0), (2_147_483_647, 2_147_483_647)],
        "",
    ),
    (
        "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal will",
        &[(0, 0)],
        "",
    ),
    (
        "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter always",
        &[(0, 0), (0, 5)],
        "TREZOR",
    ),
];

const PHRASE_CHECKS: &[&str] = &[
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
    "  ABANDON abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ART ",
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon",
    "abandon abandon zebraa",
    "abandon abandon",
    "",
];

const AMOUNTS: &[(&str, u8)] = &[
    ("1.5", 8),
    ("0.00000001", 8),
    ("92233720368.54775807", 8),
    ("007", 0),
    ("1.123456789", 8),
    ("-1", 8),
    ("1e8", 8),
    ("", 8),
    ("1.", 8),
];

const FORMATS: &[(u128, u8, Option<u8>, bool)] = &[
    (150_000_000, 8, None, false),
    (1, 8, None, false),
    (123_456_789_012_345_678, 8, Some(2), true),
    (123_456_789_012_345_678, 8, Some(0), false),
    (0, 8, None, true),
    (u128::MAX, 18, None, true),
];

/// The generator point in uncompressed form: the public key of the secret key 1.
const GENERATOR_UNCOMPRESSED: &str = "0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";

/// The network description and milestones of a local devnet of the reference implementation.
const CONFIGURATION: &str = include_str!("devnet-configuration.json");

/// The height the transaction vectors are built for.
const HEIGHT: u32 = 2;

type Failure = Box<dyn std::error::Error>;

fn profile(network: u8) -> Profile {
    Profile::devnet(DevnetOptions {
        relays: vec![RELAY.to_owned()],
        nethash: None,
    })
    .with_network_byte(network)
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn aux_for(index: usize) -> [u8; 32] {
    match index % 4 {
        0 => [7; 32],
        1 => [0; 32],
        2 => [0xff; 32],
        _ => {
            let mut bytes = [0u8; 32];
            for (i, byte) in bytes.iter_mut().enumerate() {
                *byte = u8::try_from(i).unwrap_or(0);
            }
            bytes
        }
    }
}

fn key_case(passphrase: &str) -> Result<Value, Failure> {
    let mut addresses = serde_json::Map::new();
    for &network in NETWORKS {
        let account = Account::from_legacy_passphrase(&profile(network), passphrase)?;
        addresses.insert(network.to_string(), json!(account.address().to_string()));
    }
    let devnet = profile(90);
    let account = Account::from_legacy_passphrase(&devnet, passphrase)?;
    let mut signatures = Vec::new();
    for (index, text) in MESSAGES.iter().enumerate() {
        let aux = aux_for(index);
        let signed = message::sign_bytes_with(&devnet, &account, text.as_bytes(), Aux::fixed(aux))?;
        signatures.push(json!({
            "message": hex::encode(text.as_bytes()),
            "aux": hex::encode(aux),
            "digest": hex::encode(sha256(text.as_bytes())),
            "signature": signed.signature,
        }));
    }
    Ok(json!({
        "passphrase": passphrase,
        "publicKey": account.public_key().to_hex(),
        "addresses": addresses,
        "signatures": signatures,
    }))
}

fn phrase_accounts() -> Result<Vec<Value>, Failure> {
    let devnet = profile(90);
    let mut cases = Vec::new();
    for (phrase, paths, passphrase) in PHRASES {
        let mnemonic = Mnemonic::parse(phrase)?;
        for &(account, index) in *paths {
            let derived = Account::from_phrase(
                &devnet,
                &mnemonic,
                &AccountOptions {
                    account,
                    index,
                    passphrase,
                },
            )?;
            let KeyOrigin::Phrase(path) = derived.origin() else {
                return Err("a phrase account without a path".into());
            };
            cases.push(json!({
                "phrase": phrase,
                "passphrase": passphrase,
                "account": account,
                "index": index,
                "path": path.to_string(),
                "publicKey": derived.public_key().to_hex(),
                "address": derived.address().to_string(),
            }));
        }
    }
    Ok(cases)
}

fn error_json(error: &Error) -> Value {
    json!({ "code": error.code().as_str(), "details": error.details() })
}

fn address_check(text: &str, network: u8) -> Value {
    match Address::parse(text, &profile(network)) {
        Ok(address) => json!({
            "text": text,
            "network": network,
            "ok": true,
            "bytes": hex::encode(address.as_bytes()),
        }),
        Err(Error::InvalidAddress { problem }) => {
            let details = Error::InvalidAddress { problem }.details();
            json!({
                "text": text,
                "network": network,
                "ok": false,
                "reason": details["reason"],
                "position": details.get("position").cloned().unwrap_or(Value::Null),
            })
        }
        Err(other) => json!({ "text": text, "network": network, "error": error_json(&other) }),
    }
}

fn phrase_check(text: &str) -> Value {
    let check = Mnemonic::check(text);
    let mut result = json!({ "text": text, "ok": check.is_ok(), "words": check.words });
    if let Some(problem) = check.problem {
        let details = Error::InvalidPhrase { problem }.details();
        result["reason"] = details["reason"].clone();
        if let Some(position) = details.get("position") {
            result["position"] = position.clone();
        }
    }
    result
}

fn amounts() -> (Vec<Value>, Vec<Value>) {
    let parses = AMOUNTS
        .iter()
        .map(|&(text, decimals)| match Amount::parse(text, decimals) {
            Ok(amount) => json!({ "text": text, "decimals": decimals, "units": amount.base_units().to_string() }),
            Err(error) => json!({ "text": text, "decimals": decimals, "error": error.code().as_str() }),
        })
        .collect();
    let formats = FORMATS
        .iter()
        .map(|&(units, decimals, max_fraction, grouping)| {
            json!({
                "units": units.to_string(),
                "decimals": decimals,
                "maxFraction": max_fraction,
                "grouping": grouping,
                "text": Amount::from_base_units(units).format(decimals, FormatOptions { max_fraction, grouping }),
            })
        })
        .collect();
    (parses, formats)
}

/// Who signs a transaction case: a legacy passphrase or a phrase account.
enum Signer {
    Legacy(&'static str),
    Phrase(&'static str, u32, u32),
}

impl Signer {
    fn account(&self, profile: &Profile) -> Result<Account, Failure> {
        Ok(match self {
            Signer::Legacy(passphrase) => Account::from_legacy_passphrase(profile, passphrase)?,
            Signer::Phrase(phrase, account, index) => Account::from_phrase(
                profile,
                &Mnemonic::parse(phrase)?,
                &AccountOptions {
                    account: *account,
                    index: *index,
                    passphrase: "",
                },
            )?,
        })
    }

    fn json(&self) -> Value {
        match self {
            Signer::Legacy(passphrase) => json!({ "legacyPassphrase": passphrase }),
            Signer::Phrase(phrase, account, index) => {
                json!({ "phrase": phrase, "account": account, "index": index })
            }
        }
    }
}

/// The operation in the JSON the wrapper passes to the bindings.
fn operation_json(operation: &Operation) -> Value {
    match operation {
        Operation::Transfer { recipients } => json!({
            "kind": "transfer",
            "to": recipients.iter().map(|r| json!({
                "address": r.address.to_string(),
                "amount": r.amount.base_units().to_string(),
            })).collect::<Vec<_>>(),
        }),
        Operation::Vote { entries } => json!({
            "kind": "vote",
            "entries": entries.iter().map(|e| json!({
                "validator": e.validator,
                "basisPoints": e.basis_points,
            })).collect::<Vec<_>>(),
        }),
        Operation::Burn { amount } => {
            json!({ "kind": "burn", "amount": amount.base_units().to_string() })
        }
        Operation::RegisterSecondKey { public_key } => {
            json!({ "kind": "register-second-key", "publicKey": public_key.to_hex() })
        }
        Operation::RegisterValidator { name } => {
            json!({ "kind": "register-validator", "name": name })
        }
        Operation::ResignValidator { kind } => {
            json!({ "kind": "resign-validator", "resignation": kind.as_str() })
        }
    }
}

struct TransactionCase {
    name: &'static str,
    signer: Signer,
    second: Option<Signer>,
    nonce: u64,
    operation: Operation,
    memo: Option<&'static str>,
    /// The exact fee, or `None` for the minimum: the exact fee floor.
    fee: Option<u128>,
    aux: [u8; 32],
}

fn transaction_cases(profile: &Profile) -> Result<Vec<TransactionCase>, Failure> {
    let phrase = PHRASES.first().map(|case| case.0).unwrap_or_default();
    let address =
        |signer: Signer| -> Result<Address, Failure> { Ok(*signer.account(profile)?.address()) };
    let second_key = Signer::Legacy("second passphrase")
        .account(profile)?
        .public_key()
        .to_compressed();
    Ok(vec![
        TransactionCase {
            name: "transfer to two recipients with a memo",
            signer: Signer::Legacy("probe passphrase"),
            second: None,
            nonce: 1,
            operation: Operation::Transfer {
                recipients: vec![
                    Recipient {
                        address: address(Signer::Phrase(phrase, 0, 0))?,
                        amount: Amount::from_base_units(150_000_000),
                    },
                    Recipient {
                        address: address(Signer::Phrase(phrase, 0, 1))?,
                        amount: Amount::from_base_units(1),
                    },
                ],
            },
            memo: Some("invoice 42 \u{2713}"),
            fee: Some(1_000_000),
            aux: [7; 32],
        },
        TransactionCase {
            name: "transfer at the fee floor",
            signer: Signer::Phrase(phrase, 0, 1),
            second: None,
            nonce: 5,
            operation: Operation::Transfer {
                recipients: vec![Recipient {
                    address: address(Signer::Legacy("probe passphrase"))?,
                    amount: Amount::from_base_units(42),
                }],
            },
            memo: Some("at the floor"),
            fee: None,
            aux: [6; 32],
        },
        TransactionCase {
            name: "vote for three validators, given out of order",
            signer: Signer::Phrase(phrase, 0, 0),
            second: None,
            nonce: 3,
            operation: Operation::Vote {
                entries: vec![
                    VoteEntry {
                        validator: "genesis_2".to_owned(),
                        basis_points: 2500,
                    },
                    VoteEntry {
                        validator: "genesis_10".to_owned(),
                        basis_points: 2500,
                    },
                    VoteEntry {
                        validator: "genesis_1".to_owned(),
                        basis_points: 5000,
                    },
                ],
            },
            memo: None,
            fee: Some(1_500_000),
            aux: [0x42; 32],
        },
        TransactionCase {
            name: "vote withdrawal",
            signer: Signer::Phrase(phrase, 0, 0),
            second: None,
            nonce: 4,
            operation: Operation::Vote {
                entries: Vec::new(),
            },
            memo: None,
            fee: Some(1_000_000),
            aux: [0x42; 32],
        },
        TransactionCase {
            name: "transfer signed with a second key",
            signer: Signer::Legacy("probe passphrase"),
            second: Some(Signer::Legacy("second passphrase")),
            nonce: 7,
            operation: Operation::Transfer {
                recipients: vec![Recipient {
                    address: address(Signer::Legacy("IceRoot"))?,
                    amount: Amount::from_base_units(25_000_000_000),
                }],
            },
            memo: None,
            fee: Some(2_000_000),
            aux: [1; 32],
        },
        TransactionCase {
            name: "burn",
            signer: Signer::Phrase(phrase, 1, 0),
            second: None,
            nonce: 1,
            operation: Operation::Burn {
                amount: Amount::from_base_units(2_000_000),
            },
            memo: None,
            fee: Some(0),
            aux: [2; 32],
        },
        TransactionCase {
            name: "second key registration",
            signer: Signer::Legacy("probe passphrase"),
            second: None,
            nonce: 2,
            operation: Operation::RegisterSecondKey {
                public_key: second_key,
            },
            memo: None,
            fee: Some(5_000_000),
            aux: [3; 32],
        },
        TransactionCase {
            name: "validator registration",
            signer: Signer::Phrase(phrase, 2, 0),
            second: None,
            nonce: 1,
            operation: Operation::RegisterValidator {
                name: "bergschrund".to_owned(),
            },
            memo: None,
            fee: Some(7_500_000_000),
            aux: [4; 32],
        },
        TransactionCase {
            name: "temporary resignation",
            signer: Signer::Phrase(phrase, 2, 0),
            second: None,
            nonce: 2,
            operation: Operation::ResignValidator {
                kind: Resignation::Temporary,
            },
            memo: None,
            fee: Some(0),
            aux: [5; 32],
        },
    ])
}

fn transactions() -> Result<Value, Failure> {
    let chain = Chain::load(&profile(90), CONFIGURATION)?;
    let profile = chain.profile().clone();
    let mut cases = Vec::new();
    for case in transaction_cases(&profile)? {
        let account = case.signer.account(&profile)?;
        let second = case
            .second
            .as_ref()
            .map(|signer| signer.account(&profile))
            .transpose()?;
        let facts = OnlineFacts {
            sender: account.public_key().clone(),
            nonce: case.nonce,
            height: HEIGHT,
            second_key: second.as_ref().map(|second| second.public_key().clone()),
        };
        let request = DraftRequest {
            operation: case.operation.clone(),
            memo: case.memo.map(str::to_owned),
            fee: case.fee.map_or(FeeChoice::Minimum, |fee| {
                FeeChoice::Exact(Amount::from_base_units(fee))
            }),
        };
        let draft = Draft::build(&chain, &request, &facts)?;
        let signed = draft.sign_with(&account, second.as_ref(), Aux::fixed(case.aux))?;
        if !signed.is_verified() {
            return Err(format!("{}: the signed transaction does not verify", case.name).into());
        }
        let summary = draft.summary();
        cases.push(json!({
            "name": case.name,
            "signer": case.signer.json(),
            "secondSigner": case.second.as_ref().map(Signer::json),
            "request": {
                "operation": operation_json(&case.operation),
                "memo": case.memo,
                "fee": match case.fee {
                    Some(fee) => json!({ "kind": "exact", "amount": fee.to_string() }),
                    None => json!({ "kind": "minimum" }),
                },
            },
            "facts": {
                "sender": account.public_key().to_hex(),
                "nonce": case.nonce.to_string(),
                "height": HEIGHT,
                "secondKey": second.as_ref().map(|second| second.public_key().to_hex()),
            },
            "aux": hex::encode(case.aux),
            "summary": {
                "kind": summary.operation.kind().as_str(),
                "operation": operation_json(&summary.operation),
                "from": summary.sender.to_string(),
                "nonce": summary.nonce.to_string(),
                "fee": summary.fee.amount.base_units().to_string(),
                "feeSource": summary.fee.source.as_str(),
                "feeFloor": summary.fee.floor.map(|floor| floor.base_units().to_string()),
                "amount": summary.total_amount.base_units().to_string(),
                "size": summary.size,
                "secondSignature": summary.second_signature,
            },
            "unsigned": hex::encode(draft.unsigned_bytes()),
            "draftSha256": hex::encode(sha256(&draft.serialize())),
            "id": signed.id(),
            "bytes": hex::encode(signed.bytes()),
            "json": signed.json(),
            "signedSha256": hex::encode(sha256(&signed.serialize())),
        }));
    }
    Ok(json!({
        "configuration": serde_json::from_str::<Value>(CONFIGURATION)?,
        "nethash": chain.nethash(),
        "height": HEIGHT,
        "cases": cases,
    }))
}

/// A snapshot of 32 validators with windowed data, in the JSON the wrapper passes, and selections
/// of it in every mode, computed by the vote library natively.
fn vote_cases() -> Result<Value, Failure> {
    use iceroot_sdk::vote::{
        Declarations, Mode, Payouts, Penalties, Production, SelectRequest, SnapshotSource,
        ValidatorRecord, ValidatorStatus, VoteRules, VoteSnapshot, select,
    };
    const OPERATORS: [&str; 5] = ["Acme", "Birch Ops", "Cedar", "Dune", "Elm Hosting"];
    const COUNTRIES: [&str; 6] = ["DE", "NL", "US", "BR", "JP", "ZA"];
    let records: Vec<ValidatorRecord> = (0..32u32)
        .map(|i| {
            let letter = |n: u32| char::from(b'a' + u8::try_from(n % 26).unwrap_or(0));
            let index = usize::try_from(i).unwrap_or(0);
            ValidatorRecord {
                name: format!("val{}{}", letter(i), letter(i / 26)),
                address: format!("addr-{i}"),
                rank: Some(i + 1),
                seated: i < 26,
                status: if i < 26 {
                    ValidatorStatus::Active
                } else {
                    ValidatorStatus::Standby
                },
                registered_height: Some(u64::from(i) * 1_000),
                seated_days_in_window: Some(if i < 26 { 30 } else { i % 8 }),
                vote_weight: u128::from(1_000_000 - i * 1_000),
                voters: 10 + i,
                production: Some(Production {
                    forged: 9_000 - u64::from(i % 7) * 30,
                    assigned: 9_000,
                }),
                penalties: Some(Penalties {
                    jailed_in_window: i == 5,
                    equivocation_in_window: false,
                    ever: i % 11 == 0,
                }),
                declarations: (i % 4 != 3).then(|| Declarations {
                    operator: Some(format!("{} {}", OPERATORS[index % OPERATORS.len()], i % 16)),
                    hosting: Some(format!("host {}", i % 3)),
                    country: Some(COUNTRIES[index % COUNTRIES.len()].to_owned()),
                    complete: i % 5 != 0,
                }),
                payouts: (i < 26).then(|| Payouts {
                    per_unit_weight: u128::from(100 + i * 7),
                    intervals: 30,
                }),
                self_funded_weight_bp: Some(u16::try_from(i * 50).unwrap_or(0)),
            }
        })
        .collect();
    let snapshot = VoteSnapshot {
        height: 5_000_000,
        window_days: 30,
        seats: 26,
        block_time_seconds: 8,
        source: SnapshotSource::Indexer,
        records,
    };
    let record_json = |r: &ValidatorRecord| {
        json!({
            "name": r.name, "address": r.address, "rank": r.rank, "seated": r.seated,
            "status": r.status.id(),
            "registeredHeight": r.registered_height.map(|h| h.to_string()),
            "seatedDaysInWindow": r.seated_days_in_window,
            "voteWeight": r.vote_weight.to_string(), "voters": r.voters,
            "production": r.production.map(|p| json!({ "forged": p.forged, "assigned": p.assigned })),
            "penalties": r.penalties.map(|p| json!({
                "jailedInWindow": p.jailed_in_window,
                "equivocationInWindow": p.equivocation_in_window,
                "ever": p.ever,
            })),
            "declarations": r.declarations.as_ref().map(|d| json!({
                "operator": d.operator, "hosting": d.hosting, "country": d.country,
                "complete": d.complete,
            })),
            "payouts": r.payouts.map(|p| json!({
                "perUnitWeight": p.per_unit_weight.to_string(), "intervals": p.intervals,
            })),
            "selfFundedWeightBp": r.self_funded_weight_bp,
        })
    };
    let mut selections = Vec::new();
    for mode in Mode::ALL {
        for (account, draw) in [("holder-a", 0), ("holder-b", 2)] {
            let selection = select(
                &snapshot,
                &SelectRequest {
                    draw,
                    ..SelectRequest::new(mode, account)
                },
            )?;
            selections.push(json!({
                "mode": mode.id(), "account": account, "draw": draw,
                "seed": selection.seed_hex(),
                "pool": selection.pool,
                "toppedUp": selection.topped_up,
                "entries": selection.entries.iter()
                    .map(|pick| json!([pick.validator, pick.basis_points]))
                    .collect::<Vec<_>>(),
                "topUpNotice": selection.top_up_notice(),
            }));
        }
    }
    let rules = VoteRules::ICEROOT;
    Ok(json!({
        "snapshot": {
            "height": snapshot.height.to_string(), "windowDays": snapshot.window_days,
            "seats": snapshot.seats, "blockTimeSeconds": snapshot.block_time_seconds,
            "source": snapshot.source.id(),
            "records": snapshot.records.iter().map(record_json).collect::<Vec<_>>(),
        },
        "rules": {
            "minEntries": rules.min_entries, "maxEntries": rules.max_entries,
            "maxEntryBasisPoints": rules.max_entry_basis_points, "maxBytes": rules.max_bytes,
            "names": "lowercase-letters", "validatorsMayVote": rules.validators_may_vote,
        },
        "selections": selections,
    }))
}

/// A keystore of the SDK's keystore vectors at the standard parameters (so that the published
/// functions open it), its password and the recovery phrase it holds.
fn keystore_case() -> Result<Value, Failure> {
    const VECTORS: &str = include_str!("../../../sdk-rust/vectors/sdk/S07-keystore.jsonl");
    for line in VECTORS.lines() {
        let record: Value = serde_json::from_str(line)?;
        let input = &record["input"];
        if record["op"] == "keystore.decrypt"
            && input["bounds"] == "standard"
            && record.get("output").is_some()
        {
            let keystore = input["keystore"].as_str().ok_or("a keystore")?;
            let password = input["password"].as_str().ok_or("a password")?;
            let opened = iceroot_sdk::keystore::decrypt(&hex::decode(keystore)?, password)?;
            let phrase = Mnemonic::from_entropy(opened.secret_bytes())?;
            return Ok(json!({
                "keystore": keystore,
                "text": iceroot_sdk::keystore::armor(&hex::decode(keystore)?),
                "password": password,
                "phrase": phrase.phrase(),
                "words": phrase.word_count(),
            }));
        }
    }
    Err("the keystore vectors have no standard keystore to open".into())
}

fn link_cases() -> Result<Value, Box<dyn std::error::Error>> {
    use iceroot_sdk::link::{self, LinkRequest};
    let profile = Profile::devnet(DevnetOptions {
        relays: vec!["https://node.example/api".to_owned()],
        nethash: None,
    });
    let account = Account::from_legacy_passphrase(&profile, "example link holder")?;
    let mut cases = Vec::new();
    for (revocation, id) in [
        (false, 9_999_999_001),
        (true, 9_999_999_001),
        (false, link::MAX_GITHUB_ID),
    ] {
        let request = LinkRequest {
            github_id: id,
            public_key: account.public_key(),
            issued_at: 1_790_512_496,
        };
        let message = if revocation {
            link::build_revocation(&profile, &request, 1_790_426_096)?
        } else {
            link::build(&profile, &request)?
        };
        let record = link::sign_with(
            &profile,
            &account,
            &message,
            1_790_512_497_000,
            Aux::fixed([0x42; 32]),
        )?;
        cases.push(json!({"revocation":revocation, "githubId":id, "message":message, "json":record.to_json()}));
    }
    Ok(json!(cases))
}

fn main() -> Result<(), Failure> {
    let keys = PASSPHRASES
        .iter()
        .map(|passphrase| key_case(passphrase))
        .collect::<Result<Vec<_>, _>>()?;

    let devnet = profile(90);
    let valid = Account::from_legacy_passphrase(&devnet, "probe passphrase")?
        .address()
        .to_string();
    let mut typo = valid.clone();
    typo.replace_range(5..6, "0");
    let mut checksum = valid.clone();
    checksum.replace_range(33..34, if valid.ends_with('G') { "H" } else { "G" });
    let other_network = Account::from_legacy_passphrase(&profile(30), "probe passphrase")?
        .address()
        .to_string();
    let address_checks = vec![
        address_check(&valid, 90),
        address_check(&valid, 30),
        address_check(&other_network, 90),
        address_check(&typo, 90),
        address_check(&checksum, 90),
        // Base58Check of 20 and of 22 bytes of 90: a payload that is not 21 bytes long.
        address_check("9Ek46doqep1srpD1W4QaovLWwgPmsQ6Rf", 90),
        address_check("3mUArNZj1eJNqp1Hhw7NE4nuZ2EgxjeMoREF", 90),
        address_check("111", 90),
        address_check("", 90),
        address_check("d\u{e9}", 90),
        address_check(
            "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNFdDSccdbPRhfrcbUeFLMbGC1",
            90,
        ),
    ];

    let uncompressed = PublicKey::from_hex(GENERATOR_UNCOMPRESSED)?;
    let public_key_addresses = vec![json!({
        "publicKey": GENERATOR_UNCOMPRESSED,
        "network": 90,
        "address": Address::from_public_key(&uncompressed, &devnet)?.to_string(),
    })];

    let digests: Vec<Value> = MESSAGES
        .iter()
        .map(|message| {
            json!({
                "data": hex::encode(message.as_bytes()),
                "sha256": hex::encode(sha256(message.as_bytes())),
            })
        })
        .collect();

    let (amount_parses, amount_formats) = amounts();
    let vectors = json!({
        "format": "iceroot-sdk-wasm-vectors/2",
        "description": "Native Rust results of the SDK's core that the WebAssembly build must reproduce byte for byte. Generated by wasm/examples/vectors.rs.",
        "keys": keys,
        "phraseAccounts": phrase_accounts()?,
        "phraseChecks": PHRASE_CHECKS.iter().map(|text| phrase_check(text)).collect::<Vec<_>>(),
        "digests": digests,
        "addressChecks": address_checks,
        "publicKeyAddresses": public_key_addresses,
        "amounts": { "parse": amount_parses, "format": amount_formats },
        "transactions": transactions()?,
        "vote": vote_cases()?,
        "keystore": keystore_case()?,
        "links": link_cases()?,
    });
    println!("{}", serde_json::to_string_pretty(&vectors)?);
    Ok(())
}
