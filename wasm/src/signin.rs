//! The sign-in message, version 1: built by a website's server, checked by the wallet.

use iceroot_sdk_bindings::signin;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::Result;
use crate::profile::ProfileHandle;

/// The sign-in message of `request` on the network of `profile`. `request` is JSON:
/// `{ origin, publicKey, nonce, issuedAt, expiresAt }`, the times in whole seconds since
/// 1970-01-01T00:00:00Z.
#[wasm_bindgen(js_name = buildSignIn)]
pub fn build_sign_in(profile: &ProfileHandle, request: &str) -> Result<String> {
    signin::build_sign_in(profile.profile(), request)
}

/// The fields of the sign-in `message` after every check, at the time `now_ms` (milliseconds since
/// 1970-01-01T00:00:00Z). `expected` is JSON: `{ origin?, publicKey?, address? }`, the fields the
/// reader expects. Returns JSON: `{ origin, uri, network, publicKey, address, nonce, issuedAtMs,
/// expiresAtMs }`; a refusal is `InvalidSignIn` with the reason.
#[wasm_bindgen(js_name = parseSignIn)]
pub fn parse_sign_in(
    profile: &ProfileHandle,
    message: &str,
    expected: &str,
    now_ms: f64,
) -> Result<String> {
    signin::parse_sign_in(profile.profile(), message, expected, now_ms)
}
