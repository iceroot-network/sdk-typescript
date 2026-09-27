//! S1 message signatures: BIP340 over the SHA-256 of the message's bytes.

use heartwood_crypto::PublicKey;
use heartwood_crypto::crypto::hash;
use heartwood_crypto::crypto::sig::{self, SchemeId, Signature, SigningDomain};
use wasm_bindgen::prelude::wasm_bindgen;

/// The SHA-256 of `data` (32 bytes).
#[wasm_bindgen]
pub fn sha256(data: &[u8]) -> Vec<u8> {
    hash::sha256(data).to_vec()
}

/// Whether `signature` is an S1 message signature of `message` by `public_key`.
///
/// The public key must be a valid secp256k1 key (33 or 65 bytes) and the signature 64 bytes;
/// anything else fails the check and is never an error.
#[wasm_bindgen(js_name = verifyMessage)]
pub fn verify_message(message: &[u8], public_key: &[u8], signature: &[u8]) -> bool {
    if !PublicKey::is_valid(public_key) {
        return false;
    }
    let Ok(signature) = Signature::from_bytes(signature) else {
        return false;
    };
    // See KeyHandle::sign_message: the domain changes no bytes in the S1 format.
    sig::verify(
        SchemeId::Secp256k1Bip340,
        SigningDomain::Transaction,
        &hash::sha256(message),
        &signature,
        public_key,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest() {
        assert_eq!(
            hex::encode(sha256(b"")),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn malformed_inputs_fail_the_check() {
        let key = hex::decode("03f83f83227e28add5598d2c75c20f72b4bfb0328957ef27e2da2ff73779fa4bd2")
            .unwrap();
        assert!(!verify_message(b"m", &key, &[0; 63]));
        assert!(!verify_message(b"m", &key, &[0; 64]));
        assert!(!verify_message(b"m", &key[..32], &[0; 64]));
        let mut bad_prefix = key.clone();
        bad_prefix[0] = 5;
        assert!(!verify_message(b"m", &bad_prefix, &[0; 64]));
    }
}
