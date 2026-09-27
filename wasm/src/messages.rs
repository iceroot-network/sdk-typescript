//! Message signatures in today's format: BIP340 over the SHA-256 of the message's bytes.

use iceroot_sdk_bindings::messages;
use wasm_bindgen::prelude::wasm_bindgen;

/// The SHA-256 of `data` (32 bytes).
#[wasm_bindgen]
pub fn sha256(data: &[u8]) -> Vec<u8> {
    messages::sha256(data)
}

/// Whether `signature` (hex) is a message signature of `message` by `public_key` (hex) with the
/// algorithm `algorithm`.
///
/// The public key must be a valid secp256k1 key (33 or 65 bytes) and the signature 64 bytes;
/// anything else fails the check and is never an error.
#[wasm_bindgen(js_name = verifyMessage)]
pub fn verify_message(message: &[u8], public_key: &str, signature: &str, algorithm: &str) -> bool {
    messages::verify_message(message, public_key, signature, algorithm)
}
