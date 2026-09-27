//! Secret keys held in WebAssembly memory.

use heartwood_crypto::crypto::hash;
use heartwood_crypto::crypto::sig::{self, SchemeId, SigningDomain};
use heartwood_crypto::errors::SigError;
use heartwood_crypto::{Address, Aux, KeyPair};
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::{Zeroize, Zeroizing};

use crate::error::{BindingError, ErrorCode};

/// A secret key and its public key. The secret never leaves WebAssembly memory.
///
/// [`KeyHandle::release`] wipes the key; dropping the handle (`free()` in JavaScript, or garbage
/// collection) wipes it too.
#[wasm_bindgen]
pub struct KeyHandle {
    pair: Option<KeyPair>,
    legacy: bool,
}

#[wasm_bindgen]
impl KeyHandle {
    /// The passphrase key of the reference implementation: the SHA-256 of the passphrase's UTF-8
    /// bytes. For importing existing devnet identities only; new accounts come from recovery
    /// phrases. The copy of the text in WebAssembly memory is wiped.
    #[wasm_bindgen(js_name = fromLegacyPassphrase)]
    pub fn from_legacy_passphrase(passphrase: String) -> Result<KeyHandle, BindingError> {
        let passphrase = Zeroizing::new(passphrase);
        KeyHandle::legacy_from_str(&passphrase)
    }

    /// As [`KeyHandle::from_legacy_passphrase`], from the passphrase's UTF-8 bytes. The bytes are
    /// overwritten with zeros, in WebAssembly memory and in the caller's array.
    #[wasm_bindgen(js_name = fromLegacyPassphraseBytes)]
    pub fn from_legacy_passphrase_bytes(passphrase: &mut [u8]) -> Result<KeyHandle, BindingError> {
        let result = match std::str::from_utf8(passphrase) {
            Ok(text) => KeyHandle::legacy_from_str(text),
            Err(_) => Err(BindingError::new(
                ErrorCode::InvalidPhrase,
                "the passphrase bytes are not UTF-8",
            )),
        };
        passphrase.zeroize();
        result
    }

    /// The compressed public key (33 bytes).
    #[wasm_bindgen(js_name = publicKey)]
    pub fn public_key(&self) -> Result<Vec<u8>, BindingError> {
        Ok(self.pair()?.public_key().as_bytes().to_vec())
    }

    /// The S1 address of the key on the network with byte `network`.
    pub fn address(&self, network: u8) -> Result<String, BindingError> {
        let pair = self.pair()?;
        Ok(Address::from_public_key(pair.public_key(), network).to_base58())
    }

    /// The S1 message signature: BIP340 over the SHA-256 of `message`, with fresh auxiliary
    /// randomness (64 bytes).
    ///
    /// The digest is always passed to the signer, because the signer takes a 32-byte input as
    /// given; a message of exactly 32 bytes is hashed like any other.
    #[wasm_bindgen(js_name = signMessage)]
    pub fn sign_message(&self, message: &[u8]) -> Result<Vec<u8>, BindingError> {
        self.sign_digest(&hash::sha256(message), Aux::random())
    }

    /// Whether the key was derived from a legacy passphrase.
    #[wasm_bindgen(getter)]
    pub fn legacy(&self) -> bool {
        self.legacy
    }

    /// Whether the key was released.
    #[wasm_bindgen(getter)]
    pub fn released(&self) -> bool {
        self.pair.is_none()
    }

    /// Wipes the secret key. Every later call that needs the key fails with `KeyReleased`.
    pub fn release(&mut self) {
        // Dropping the key pair overwrites the secret key's bytes.
        self.pair = None;
    }
}

/// Reproducible signatures, in test builds only.
#[cfg(feature = "fixed-aux")]
#[wasm_bindgen]
impl KeyHandle {
    /// As [`KeyHandle::sign_message`], with these 32 auxiliary bytes instead of random ones.
    #[wasm_bindgen(js_name = signMessageWithAux)]
    pub fn sign_message_with_aux(
        &self,
        message: &[u8],
        aux: &[u8],
    ) -> Result<Vec<u8>, BindingError> {
        let aux = <[u8; 32]>::try_from(aux).map_err(|_| {
            BindingError::new(
                ErrorCode::InvalidAux,
                "the auxiliary bytes must be 32 bytes",
            )
        })?;
        self.sign_digest(&hash::sha256(message), Aux::fixed(aux))
    }
}

impl std::fmt::Debug for KeyHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never shows key material.
        f.debug_struct("KeyHandle")
            .field("legacy", &self.legacy)
            .field("released", &self.pair.is_none())
            .finish_non_exhaustive()
    }
}

impl KeyHandle {
    fn legacy_from_str(passphrase: &str) -> Result<KeyHandle, BindingError> {
        let pair = KeyPair::from_passphrase(passphrase).map_err(|_| {
            BindingError::new(
                ErrorCode::InvalidPhrase,
                "the passphrase does not give a valid secret key",
            )
        })?;
        Ok(KeyHandle {
            pair: Some(pair),
            legacy: true,
        })
    }

    fn pair(&self) -> Result<&KeyPair, BindingError> {
        self.pair
            .as_ref()
            .ok_or_else(|| BindingError::new(ErrorCode::KeyReleased, "the key was released"))
    }

    fn sign_digest(&self, digest: &[u8; 32], aux: Aux) -> Result<Vec<u8>, BindingError> {
        let pair = self.pair()?;
        // heartwood-crypto at the pinned revision has no message domain yet. In the S1 format the
        // domain changes no bytes, so the transaction domain signs the same bytes.
        sig::sign(
            SchemeId::Secp256k1Bip340,
            SigningDomain::Transaction,
            digest,
            pair.secret_key(),
            aux,
        )
        .map(|signature| signature.as_bytes().to_vec())
        .map_err(|error| match error {
            SigError::Randomness => BindingError::new(
                ErrorCode::RandomnessUnavailable,
                "no random bytes are available for signing",
            ),
            other => BindingError::new(ErrorCode::SigningFailed, other.to_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::verify_message;

    const PUBLIC_KEY: &str = "03f83f83227e28add5598d2c75c20f72b4bfb0328957ef27e2da2ff73779fa4bd2";
    const ADDRESS: &str = "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF";

    #[test]
    fn legacy_passphrase() {
        let key = KeyHandle::from_legacy_passphrase("probe passphrase".to_owned()).unwrap();
        assert!(key.legacy());
        assert_eq!(hex::encode(key.public_key().unwrap()), PUBLIC_KEY);
        assert_eq!(key.address(90).unwrap(), ADDRESS);

        let mut bytes = b"probe passphrase".to_vec();
        let from_bytes = KeyHandle::from_legacy_passphrase_bytes(&mut bytes).unwrap();
        assert_eq!(from_bytes.address(90).unwrap(), ADDRESS);
        assert!(bytes.iter().all(|&byte| byte == 0));

        let mut invalid = vec![0xff, 0xfe];
        let error = KeyHandle::from_legacy_passphrase_bytes(&mut invalid).unwrap_err();
        assert_eq!(error.code(), ErrorCode::InvalidPhrase);
        assert_eq!(invalid, [0, 0]);
    }

    #[test]
    fn sign_and_release() {
        let mut key = KeyHandle::from_legacy_passphrase("probe passphrase".to_owned()).unwrap();
        let public_key = key.public_key().unwrap();
        let message = b"IceRoot sign-in test";
        let signature = key.sign_message(message).unwrap();
        assert_eq!(signature.len(), 64);
        assert!(verify_message(message, &public_key, &signature));
        assert!(!verify_message(b"another message", &public_key, &signature));

        key.release();
        assert!(key.released());
        assert_eq!(
            key.sign_message(message).unwrap_err().code(),
            ErrorCode::KeyReleased
        );
        assert_eq!(key.address(90).unwrap_err().code(), ErrorCode::KeyReleased);
    }

    #[cfg(feature = "fixed-aux")]
    #[test]
    fn fixed_aux_matches_the_probe() {
        let key = KeyHandle::from_legacy_passphrase("probe passphrase".to_owned()).unwrap();
        let signature = key
            .sign_message_with_aux(b"IceRoot sign-in test", &[7; 32])
            .unwrap();
        let hex = hex::encode(signature);
        assert!(hex.starts_with("a2ca2893"), "{hex}");
        assert!(hex.ends_with("aeba5518f"), "{hex}");
        assert_eq!(
            key.sign_message_with_aux(b"x", &[7; 31])
                .unwrap_err()
                .code(),
            ErrorCode::InvalidAux
        );
    }
}
