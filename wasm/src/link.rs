//! Account links and revocations through the shared JSON boundary.
use crate::{error::Result, keys::KeyHandle, profile::ProfileHandle};
use iceroot_sdk_bindings::link;
use wasm_bindgen::prelude::wasm_bindgen;

/// Build a link or revocation from a JSON request with times in seconds.
#[wasm_bindgen(js_name = buildLink)]
pub fn build_link(profile: &ProfileHandle, request: &str) -> Result<String> {
    link::build_link(profile.profile(), request)
}
/// Parse exact text against expected fields and a clock in milliseconds.
#[wasm_bindgen(js_name = parseLink)]
pub fn parse_link(
    profile: &ProfileHandle,
    message: &str,
    expected: &str,
    now: f64,
) -> Result<String> {
    link::parse_link(profile.profile(), message, expected, now)
}
/// Verify raw record JSON, including its member count.
#[wasm_bindgen(js_name = verifyLink)]
pub fn verify_link(
    profile: &ProfileHandle,
    record: &str,
    expected: &str,
    now: f64,
) -> Result<String> {
    link::verify_link(profile.profile(), record, expected, now)
}
/// Canonical record JSON.
#[wasm_bindgen(js_name = linkRecordJson)]
pub fn link_record_json(record: &str) -> Result<String> {
    link::link_record_json(record)
}
/// Apply the no-replay rule to verified history.
#[wasm_bindgen(js_name = checkLinkHistory)]
pub fn check_link_history(
    profile: &ProfileHandle,
    message: &str,
    history: &str,
    now: f64,
) -> Result<()> {
    link::check_link_history(profile.profile(), message, history, now)
}
#[wasm_bindgen]
impl KeyHandle {
    /// Check the message where the key signs, using fresh randomness.
    #[wasm_bindgen(js_name = signLink)]
    pub fn sign_link(&self, message: &str, now: f64) -> Result<String> {
        self.key().sign_link(message, now)
    }
}
#[cfg(feature = "fixed-aux")]
#[wasm_bindgen]
impl KeyHandle {
    /// Checked signing with fixed randomness, available only in test builds.
    #[wasm_bindgen(js_name = signLinkWithAux)]
    pub fn sign_link_with_aux(&self, message: &str, now: f64, aux: &[u8]) -> Result<String> {
        self.key()
            .sign_link_with(message, now, iceroot_sdk_bindings::draft::fixed_aux(aux)?)
    }
}
