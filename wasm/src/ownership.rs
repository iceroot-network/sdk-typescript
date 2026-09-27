//! Ownership proofs of Solar addresses, version 1: the SDK core's `ownership` module.
//!
//! A holder proves control of a Solar mainnet address by signing a fixed nine-line message that
//! names the address and an IceRoot account, as the IceRoot Legacy Signer does. These functions
//! need no network profile.
//!
//! A Solar key is held in WebAssembly memory like an account's key: JavaScript receives its
//! address and public key, [`SolarKeyHandle::release`] wipes it, and a passphrase given as bytes
//! is overwritten with zeros whatever the outcome. The message functions share one export,
//! [`ownership_call`], which keeps the module small. Refusals are the core's `InvalidProof` with
//! its `reason`; an argument of the wrong shape is `InvalidArgument`.

use iceroot_sdk_bindings::ownership::{self, ProofKey};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::Result;

/// A Solar key from its passphrase, held in WebAssembly memory. It signs ownership proofs and
/// nothing else.
#[wasm_bindgen]
pub struct SolarKeyHandle {
    key: ProofKey,
}

#[wasm_bindgen]
impl SolarKeyHandle {
    /// The Solar key of the passphrase in `passphrase` (UTF-8 bytes): the SHA-256 of the exact
    /// text, as the reference implementation derives it. The bytes are overwritten with zeros,
    /// in WebAssembly memory and in the caller's array, whatever the outcome.
    #[wasm_bindgen(js_name = fromPassphrase)]
    pub fn from_passphrase(passphrase: &mut [u8]) -> Result<SolarKeyHandle> {
        ProofKey::from_passphrase(passphrase).map(|key| SolarKeyHandle { key })
    }

    /// The key's Solar mainnet address.
    #[wasm_bindgen(getter)]
    pub fn address(&self) -> Result<String> {
        self.key.address()
    }

    /// The key's public key, 33 bytes compressed, as lowercase hex.
    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> Result<String> {
        self.key.public_key()
    }

    /// Wipes the key. Later calls throw `KeyReleased`.
    pub fn release(&mut self) {
        // The key is dropped where it is held, which overwrites its bytes.
        self.key.release();
    }

    /// The proof of `message` signed with this key and fresh randomness at the signer's time
    /// `now_ms`, as the proof's JSON text. The message must pass the format's checks and name
    /// this key's address.
    #[wasm_bindgen(js_name = signProof)]
    pub fn sign_proof(&self, message: &str, now_ms: f64) -> Result<String> {
        self.key.sign_proof(message, now_ms)
    }
}

/// Test seam of the bindings only (feature `fixed-aux`, which the test build of the package turns
/// on and the published build never does): a proof signed with fixed auxiliary randomness, so the
/// ownership vectors' signatures can be reproduced.
#[cfg(feature = "fixed-aux")]
#[wasm_bindgen]
impl SolarKeyHandle {
    /// As [`SolarKeyHandle::sign_proof`], with these 32 auxiliary bytes.
    #[wasm_bindgen(js_name = signProofWithAux)]
    pub fn sign_proof_with_aux(&self, message: &str, now_ms: f64, aux: &[u8]) -> Result<String> {
        let aux = iceroot_sdk_bindings::draft::fixed_aux(aux)?;
        self.key.sign_proof_with(message, now_ms, aux)
    }
}

/// The ownership proof functions, by `operation`, as the shared bindings' `ownership_call`
/// documents them: `source-address`, `account`, `account-canonical`, `nonce`, `build`, `parse`,
/// `from-signature`, `verify` and `from-json`.
#[wasm_bindgen(js_name = ownershipCall)]
pub fn ownership_call(operation: &str, first: &str, second: &str, now_ms: f64) -> Result<String> {
    ownership::ownership_call(operation, first, second, now_ms)
}
