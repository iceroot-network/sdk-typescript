//! Addresses, always checked against a network profile.

use iceroot_sdk_bindings::address;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::Result;
use crate::profile::ProfileHandle;

/// The bytes of the address in `text`, which must belong to the network of `profile`: 21 bytes,
/// the network byte and the key hash, in today's format.
///
/// A refusal is `InvalidAddress` with the reason `format` (and the position of the first bad
/// character, when one is to blame), `checksum`, `length` or `wrong-network`.
#[wasm_bindgen(js_name = parseAddress)]
pub fn parse_address(text: &str, profile: &ProfileHandle) -> Result<Vec<u8>> {
    address::parse_address(text, profile.profile())
}

/// The address of `public_key` (33 or 65 bytes) on the network of `profile`.
#[wasm_bindgen(js_name = addressFromPublicKey)]
pub fn address_from_public_key(public_key: &[u8], profile: &ProfileHandle) -> Result<String> {
    address::address_from_public_key(public_key, profile.profile())
}
