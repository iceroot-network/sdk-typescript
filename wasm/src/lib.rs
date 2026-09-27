//! WebAssembly bindings of the IceRoot SDK.
//!
//! This crate is the boundary between the Rust core and the TypeScript wrapper. Every key, address
//! and signature comes from `heartwood-crypto`, Heartwood Core's byte-exact layer, so the results
//! are identical to native Rust.
//!
//! Rules for the whole crate:
//!
//! - Secret keys stay in WebAssembly memory. JavaScript receives public keys, addresses and
//!   signatures only, and [`KeyHandle::release`] wipes a key.
//! - Untrusted input never causes a panic: every failure is a [`BindingError`] with a stable code,
//!   which the wrapper turns into its typed errors.
//! - No I/O. Requests to a node are made by the host language.
//!
//! The surface is deliberately small for now: legacy passphrase keys, S1 addresses and S1 message
//! signatures.

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
mod error;
mod keys;
mod messages;

use wasm_bindgen::prelude::wasm_bindgen;

pub use crate::address::{address_from_public_key, parse_address};
pub use crate::error::{BindingError, ErrorCode};
pub use crate::keys::KeyHandle;
pub use crate::messages::{sha256, verify_message};

/// The version of these bindings.
#[wasm_bindgen(js_name = bindingsVersion)]
pub fn bindings_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}
