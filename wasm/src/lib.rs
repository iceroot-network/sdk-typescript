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
//!   signatures only, and [`KeyHandle::release`] wipes a key.
//! - Untrusted input never causes a panic: every failure is a [`BindingError`] with the core's
//!   stable code and details, which the wrapper turns into its typed errors.
//! - No I/O. Requests to a node are made by the host language.
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
mod chain;
mod draft;
mod error;
mod json;
mod keys;
mod messages;
mod phrase;
mod profile;
mod signin;

use wasm_bindgen::prelude::wasm_bindgen;

pub use crate::address::{address_from_public_key, parse_address};
pub use crate::amount::{format_amount, parse_amount};
pub use crate::chain::ChainHandle;
pub use crate::draft::{DraftHandle, SignedHandle};
pub use crate::error::BindingError;
pub use crate::keys::KeyHandle;
pub use crate::messages::{sha256, verify_message};
pub use crate::phrase::{check_phrase, generate_phrase};
pub use crate::profile::ProfileHandle;
pub use crate::signin::{build_sign_in, parse_sign_in};

/// The version of these bindings.
#[wasm_bindgen(js_name = bindingsVersion)]
pub fn bindings_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}
