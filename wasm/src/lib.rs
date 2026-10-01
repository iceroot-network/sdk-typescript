//! WebAssembly bindings of the IceRoot SDK.
//!
//! This crate is the boundary between the SDK's Rust core (`iceroot-sdk`) and the TypeScript
//! wrapper. It adds no logic of its own: every key, address, amount, draft, signature and rule
//! comes from the core, and through it from `heartwood-crypto`, so the results are identical to
//! native Rust. Arguments are read and answers written by sdk-rust's `iceroot-sdk-bindings`, which
//! the native Tauri plugin shares, so both implementations of the TypeScript interface read and
//! write the same JSON; this crate adds the exports, the JavaScript values and the handles that
//! keep the core's values in WebAssembly memory.
//!
//! Rules for the whole crate:
//!
//! - Secret keys stay in WebAssembly memory. JavaScript receives public keys, addresses and
//!   signatures only, and [`KeyHandle::release`] wipes a key. Phrases and passwords given as
//!   bytes are overwritten with zeros, and the keystore gives a decrypted phrase back as a new
//!   byte array for the caller to wipe. The stack lives in WebAssembly memory too, so the
//!   wrapper calls [`wipe_stack`] after every call into the module: what hashing, derivation,
//!   signing and decryption leave in their frames does not outlive the call.
//! - Untrusted input never causes a panic: every failure is a [`BindingError`] with the core's
//!   stable code and details, which the wrapper turns into its typed errors.
//! - No I/O. Requests to a node are made by the host language: the bindings build each request
//!   and decode each answer with the SDK's node API client, and the host sends them.
//! - Structured values cross the boundary as JSON text. Amounts and nonces are decimal strings,
//!   because JavaScript numbers cannot hold every `u64` or `u128`; the wrapper makes them `bigint`.

#![deny(unsafe_code)]
#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )
)]

mod address;
mod amount;
mod api;
mod chain;
mod draft;
mod error;
mod keys;
mod keystore;
mod messages;
mod ownership;
mod phrase;
mod profile;
mod signin;
mod vote;

use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroize;

pub use crate::address::{address_from_public_key, parse_address};
pub use crate::amount::{format_amount, parse_amount};
pub use crate::api::{ApiCall, RequestBudgetHandle, SubmitPlanHandle, backoff_delay, check_relay};
pub use crate::chain::ChainHandle;
pub use crate::draft::{DraftHandle, SignedHandle, online_facts};
pub use crate::error::BindingError;
pub use crate::keys::KeyHandle;
pub use crate::keystore::{
    keystore_armor, keystore_change_password, keystore_check_params, keystore_dearmor,
    keystore_decrypt, keystore_encrypt, keystore_inspect, keystore_is_weaker, keystore_reencrypt,
};
pub use crate::messages::{sha256, verify_message};
pub use crate::ownership::{SolarKeyHandle, ownership_call};
pub use crate::phrase::{check_phrase, generate_phrase};
pub use crate::profile::ProfileHandle;
pub use crate::signin::{build_sign_in, parse_sign_in};
pub use crate::vote::{vote_call, vote_rules_at, vote_snapshot_from_validators};

/// The version of these bindings.
#[wasm_bindgen(js_name = bindingsVersion)]
pub fn bindings_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// How much of the stack [`wipe_stack`] overwrites: several times what any call into the module
/// uses (the deepest, a keystore's key derivation, about 11 KiB).
const WIPED_STACK_BYTES: usize = 64 * 1024;

/// Overwrites with zeros the stack below the caller's frame.
///
/// In WebAssembly the stack of Rust (and of the C code of libsecp256k1) lives in the module's
/// memory, and a function that returns leaves the contents of its frame there until later calls
/// overwrite them. Hashing a phrase's checksum, deriving a key, signing and decrypting a keystore
/// leave copies of secrets in such frames: a keystore's entropy, the bytes of a key that
/// `release` wiped from its handle. The wrapper calls this after every call into the module,
/// when no frame of the module is in use, so none of those copies outlives the call. It writes
/// only to its own frame, below every frame in use, so it is safe at any time.
#[wasm_bindgen(js_name = wipeStack)]
pub fn wipe_stack() {
    let mut frame = [0u64; WIPED_STACK_BYTES / 8];
    frame.zeroize();
    core::hint::black_box(&frame);
}

/// Test seam of the bindings only (feature `fixed-aux`, which the test build of the package turns
/// on and the published build never does): the module's memory, so that the tests can check that
/// no copy of a secret is left in it.
#[cfg(feature = "fixed-aux")]
#[wasm_bindgen(js_name = wasmMemory)]
pub fn wasm_memory() -> wasm_bindgen::JsValue {
    wasm_bindgen::memory()
}

#[cfg(test)]
mod tests {
    //! The exports over the shared bindings, natively: the logic itself is tested in
    //! `iceroot-sdk-bindings`, and every export in WebAssembly by the package's tests.

    use super::*;
    use serde_json::{Value, json};

    const CONFIGURATION: &str = include_str!("../examples/devnet-configuration.json");
    const PROFILE: &str = r#"{"id":"devnet","backend":"solar-compat","api":{"relays":["http://127.0.0.1:4003/api"]},"chain":{"networkByte":90},"keyScheme":"bip32-secp256k1"}"#;
    const RECIPIENT: &str = "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF";

    #[test]
    fn a_draft_is_built_signed_and_submitted_through_the_exports() {
        let profile = ProfileHandle::from_json(PROFILE).unwrap();
        let chain = ChainHandle::load(&profile, CONFIGURATION).unwrap();
        let mut key = KeyHandle::from_legacy_passphrase(&profile, "sender".to_owned()).unwrap();
        let sender = hex::encode(key.public_key().unwrap());
        let status = r#"{"height":"80","synced":true,"blocksBehind":"0","chainTime":"656"}"#;
        let facts = online_facts(&chain, &sender, None, status).unwrap();
        let request = json!({
            "operation": { "kind": "transfer", "to": [{ "address": RECIPIENT, "amount": "150000000" }] },
            "fee": { "kind": "exact", "amount": "1000000" },
        });
        let draft = DraftHandle::build(&chain, &request.to_string(), &facts).unwrap();
        let summary: Value = serde_json::from_str(&draft.summary()).unwrap();
        assert_eq!(summary["nonce"], "1");
        let signed = draft.sign(&key).unwrap();
        assert!(signed.verified());
        let back = SignedHandle::deserialize(&signed.serialize(), &chain.profile()).unwrap();
        assert_eq!(back.id(), signed.id());

        let mut plan = SubmitPlanHandle::new(40, 2_000_000);
        plan.add(&signed).unwrap();
        assert_eq!(plan.plan().unwrap(), 1);
        let call = ApiCall::prepare(53, "nodeStatus", "{}").unwrap();
        assert!(call.request().contains("/node/status"));

        key.release();
        assert!(key.released());
        let error = draft.sign(&key).unwrap_err();
        assert_eq!(error.code(), "KeyReleased");
    }

    #[test]
    fn a_draft_s_floor_is_the_floor_only_on_the_reader_s_chain() {
        let profile = ProfileHandle::from_json(PROFILE).unwrap();
        let chain = ChainHandle::load(&profile, CONFIGURATION).unwrap();
        let key = KeyHandle::from_legacy_passphrase(&profile, "sender".to_owned()).unwrap();
        let facts =
            json!({ "sender": hex::encode(key.public_key().unwrap()), "nonce": "1", "height": 2 });
        let request = json!({ "operation": { "kind": "transfer", "to": [{ "address": RECIPIENT, "amount": "1" }] } });
        let draft = DraftHandle::build(&chain, &request.to_string(), &facts.to_string()).unwrap();
        let source = |draft: &DraftHandle| {
            let summary: Value = serde_json::from_str(&draft.summary()).unwrap();
            summary["fee"]["source"].clone()
        };
        assert_eq!(source(&draft), "floor");
        let bytes = draft.serialize();
        let alone = DraftHandle::deserialize(&bytes, &chain.profile()).unwrap();
        assert_eq!(source(&alone), "unverified");
        for height in [2, 81, u32::MAX] {
            let on_chain = DraftHandle::deserialize_at(&bytes, &chain, height).unwrap();
            assert_eq!(source(&on_chain), "floor");
        }
        let text = String::from_utf8(bytes).unwrap();
        let tampered = text.replace(r#""minFee":6173"#, r#""minFee":61730"#);
        assert_ne!(tampered, text);
        let refused = DraftHandle::deserialize_at(tampered.as_bytes(), &chain, 81).unwrap_err();
        assert_eq!(refused.code(), "NetworkMismatch");
        assert_eq!(refused.details()["reason"], "configuration");

        // Fees are lowered at height 100: a draft of height 2 has its fee called the floor while
        // the network's next block is before the change, and unverified once it is past it.
        let mut configuration: Value = serde_json::from_str(CONFIGURATION).unwrap();
        let milestones = configuration["milestones"].as_array_mut().unwrap();
        let mut lowered = milestones.last().unwrap().clone();
        lowered["height"] = json!(100);
        lowered["dynamicFees"]["minFee"] = json!(3000);
        milestones.push(lowered);
        let changing = ChainHandle::load(&profile, &configuration.to_string()).unwrap();
        let draft =
            DraftHandle::build(&changing, &request.to_string(), &facts.to_string()).unwrap();
        let bytes = draft.serialize();
        for (height, expected) in [
            (2, "floor"),
            (99, "floor"),
            (100, "unverified"),
            (u32::MAX, "unverified"),
        ] {
            let read = DraftHandle::deserialize_at(&bytes, &changing, height).unwrap();
            assert_eq!(source(&read), expected, "{height}");
        }
    }

    #[test]
    fn a_sign_in_message_is_signed_only_once_it_passes_its_checks() {
        let profile = ProfileHandle::from_json(PROFILE).unwrap();
        let key = KeyHandle::from_legacy_passphrase(&profile, "sender".to_owned()).unwrap();
        let request = json!({
            "origin": "https://validators.example",
            "publicKey": hex::encode(key.public_key().unwrap()),
            "nonce": "ab".repeat(32),
            "issuedAt": 1_790_000_000,
            "expiresAt": 1_790_000_300,
        });
        let message = build_sign_in(&profile, &request.to_string()).unwrap();
        let refused = key.sign_message(message.as_bytes()).unwrap_err();
        assert_eq!(refused.code(), "InvalidArgument");
        assert_eq!(
            refused.details()["reason"],
            "a sign-in message is signed only for the page that asks for it, never as a plain message"
        );
        let now = 1_790_000_060_000.0;
        let signed: Value = serde_json::from_str(
            &key.sign_sign_in(&message, "https://validators.example", now)
                .unwrap(),
        )
        .unwrap();
        assert!(verify_message(
            message.as_bytes(),
            signed["publicKey"].as_str().unwrap(),
            signed["signature"].as_str().unwrap(),
            signed["algorithm"].as_str().unwrap(),
        ));
        for (origin, now, reason) in [
            ("https://other.example", now, "mismatch"),
            ("https://validators.example", now + 600_000.0, "expired"),
        ] {
            let refused = key.sign_sign_in(&message, origin, now).unwrap_err();
            assert_eq!(refused.code(), "InvalidSignIn");
            assert_eq!(refused.details()["reason"], reason);
        }
    }

    #[test]
    fn errors_keep_their_code_and_details() {
        let profile = ProfileHandle::from_json(PROFILE).unwrap();
        let error = parse_address("dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNX", &profile).unwrap_err();
        assert_eq!(error.code(), "InvalidAddress");
        assert_eq!(error.details()["reason"], "checksum");
        assert_eq!(
            vote_call("nothing", "", "", "").unwrap_err().code(),
            "InvalidArgument"
        );
        assert_eq!(parse_amount("1.5", 8).unwrap(), "150000000");
        assert_eq!(keystore_armor(b"x").len(), "irks:".len() + 2);
    }
}
