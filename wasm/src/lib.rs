//! WebAssembly bindings of the IceRoot SDK.
//!
//! This crate is the boundary between the SDK's Rust core (`iceroot-sdk`) and the TypeScript
//! wrapper. It adds no logic of its own: every key, address, amount, draft, signature and rule
//! comes from the core, and through it from `heartwood-crypto`, so the results are identical to
//! native Rust.
//!
//! Rules for the whole crate:
//!
//! - Secret keys stay in WebAssembly memory. JavaScript receives public keys, addresses and
//!   signatures only, and [`KeyHandle::release`] wipes a key. Phrases and passwords given as
//!   bytes are overwritten with zeros, and the keystore gives a decrypted phrase back as a new
//!   byte array for the caller to wipe.
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
mod json;
mod keys;
mod keystore;
mod messages;
mod ownership;
mod phrase;
mod profile;
mod signin;
mod vote;
mod write;

use wasm_bindgen::prelude::wasm_bindgen;

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
pub use crate::vote::{
    vote_call, vote_check, vote_evaluate, vote_rules_at, vote_select,
    vote_snapshot_from_validators, vote_split, vote_validate, vote_validate_snapshot, vote_voter,
};

/// The version of these bindings.
#[wasm_bindgen(js_name = bindingsVersion)]
pub fn bindings_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}
