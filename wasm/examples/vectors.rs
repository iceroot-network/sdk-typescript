//! Prints the native Rust results that every JavaScript context must reproduce byte for byte.
//!
//! ```sh
//! cargo run --example vectors --features fixed-aux > ../test/vectors/wasm-native.json
//! ```
//!
//! Keys, addresses and signatures are computed with `heartwood-crypto` directly, not through the
//! bindings, so the file is an independent native reference for the WebAssembly build. Address
//! checks go through the bindings' own parser, compiled natively.

use heartwood_crypto::crypto::hash::sha256;
use heartwood_crypto::crypto::sig::{self, SchemeId, SigningDomain};
use heartwood_crypto::{Address, Aux, KeyPair, PublicKey};
use serde_json::{Value, json};

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

/// The generator point in uncompressed form: the public key of the secret key 1.
const GENERATOR_UNCOMPRESSED: &str = "0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";

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

fn key_case(passphrase: &str) -> Result<Value, Box<dyn std::error::Error>> {
    let pair = KeyPair::from_passphrase(passphrase)?;
    let public_key = pair.public_key();
    let addresses: serde_json::Map<String, Value> = NETWORKS
        .iter()
        .map(|&network| {
            (
                network.to_string(),
                Value::from(Address::from_public_key(public_key, network).to_base58()),
            )
        })
        .collect();
    let mut signatures = Vec::new();
    for (index, message) in MESSAGES.iter().enumerate() {
        let aux = aux_for(index);
        let digest = sha256(message.as_bytes());
        let signature = sig::sign(
            SchemeId::Secp256k1Bip340,
            SigningDomain::Transaction,
            &digest,
            pair.secret_key(),
            Aux::fixed(aux),
        )?;
        signatures.push(json!({
            "message": hex::encode(message.as_bytes()),
            "aux": hex::encode(aux),
            "digest": hex::encode(digest),
            "signature": signature.to_hex(),
        }));
    }
    Ok(json!({
        "passphrase": passphrase,
        "publicKey": public_key.to_hex(),
        "addresses": addresses,
        "signatures": signatures,
    }))
}

fn address_check(text: &str, network: u8) -> Value {
    match iceroot_sdk_wasm::parse_address(text, network) {
        Ok(bytes) => {
            json!({ "text": text, "network": network, "ok": true, "bytes": hex::encode(bytes) })
        }
        Err(error) => json!({
            "text": text,
            "network": network,
            "ok": false,
            "reason": error.reason().map(|reason| reason.as_str()),
            "position": error.position(),
        }),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let keys = PASSPHRASES
        .iter()
        .map(|passphrase| key_case(passphrase))
        .collect::<Result<Vec<_>, _>>()?;

    let valid = Address::from_public_key(
        KeyPair::from_passphrase("probe passphrase")?.public_key(),
        90,
    )
    .to_base58();
    let mut typo = valid.clone();
    typo.replace_range(5..6, "0");
    let mut checksum = valid.clone();
    checksum.replace_range(33..34, if valid.ends_with('G') { "H" } else { "G" });
    let short_payload = heartwood_crypto::utils::base58::encode_check(&[90; 20]);
    let long_payload = heartwood_crypto::utils::base58::encode_check(&[90; 22]);
    let address_checks = vec![
        address_check(&valid, 90),
        address_check(&valid, 30),
        address_check(&typo, 90),
        address_check(&checksum, 90),
        address_check(&short_payload, 90),
        address_check(&long_payload, 90),
        address_check("111", 90),
        address_check("", 90),
        address_check("d\u{e9}", 90),
    ];

    let uncompressed = PublicKey::from_hex(GENERATOR_UNCOMPRESSED)?;
    let public_key_addresses = vec![json!({
        "publicKey": GENERATOR_UNCOMPRESSED,
        "network": 90,
        "address": Address::from_public_key(&uncompressed, 90).to_base58(),
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

    let vectors = json!({
        "format": "iceroot-sdk-wasm-vectors/1",
        "description": "Native Rust results of heartwood-crypto that the WebAssembly build must reproduce byte for byte. Generated by wasm/examples/vectors.rs.",
        "keys": keys,
        "digests": digests,
        "addressChecks": address_checks,
        "publicKeyAddresses": public_key_addresses,
    });
    println!("{}", serde_json::to_string_pretty(&vectors)?);
    Ok(())
}
