//! Accounts whose secret keys are held in WebAssembly memory.

use iceroot_sdk::keys::{Account, AccountOptions, KeyOrigin};
use iceroot_sdk::message::{self, MessageSignature};
use iceroot_sdk::phrase::Mnemonic;
use iceroot_sdk::{Aux, Profile};
use serde_json::json;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::{Zeroize, Zeroizing};

use crate::error::{BindingError, Result};
use crate::profile::ProfileHandle;

/// An account of the core: a secret key, its public key and address, and the profile it belongs
/// to. The secret never leaves WebAssembly memory.
///
/// [`KeyHandle::release`] wipes the key; dropping the handle (`free()` in JavaScript, or garbage
/// collection) wipes it too.
#[wasm_bindgen]
pub struct KeyHandle {
    account: Option<Account>,
    profile: Profile,
    legacy: bool,
    path: Option<String>,
}

#[wasm_bindgen]
impl KeyHandle {
    /// The account at `account` and `index` of the recovery phrase `phrase` (18, 21 or 24 BIP39
    /// English words), with the optional BIP39 `passphrase`, derived with the key scheme of
    /// `profile`. The copies of the phrase and passphrase in WebAssembly memory are wiped.
    #[wasm_bindgen(js_name = fromPhrase)]
    pub fn from_phrase(
        profile: &ProfileHandle,
        phrase: String,
        account: u32,
        index: u32,
        passphrase: String,
    ) -> Result<KeyHandle> {
        let phrase = Zeroizing::new(phrase);
        let passphrase = Zeroizing::new(passphrase);
        let mnemonic = Mnemonic::parse(&phrase)?;
        KeyHandle::from_mnemonic(profile, &mnemonic, account, index, &passphrase)
    }

    /// As [`KeyHandle::from_phrase`], from the phrase's UTF-8 bytes. The bytes are overwritten
    /// with zeros, in WebAssembly memory and in the caller's array, whatever the outcome.
    #[wasm_bindgen(js_name = fromPhraseBytes)]
    pub fn from_phrase_bytes(
        profile: &ProfileHandle,
        phrase: &mut [u8],
        account: u32,
        index: u32,
        passphrase: String,
    ) -> Result<KeyHandle> {
        let passphrase = Zeroizing::new(passphrase);
        let result = Mnemonic::parse_utf8(phrase)
            .map_err(BindingError::from)
            .and_then(|mnemonic| {
                KeyHandle::from_mnemonic(profile, &mnemonic, account, index, &passphrase)
            });
        phrase.zeroize();
        result
    }

    /// The reference implementation's passphrase key: the SHA-256 of the passphrase's UTF-8
    /// bytes. For importing existing devnet identities only, on profiles in today's formats; new
    /// accounts come from recovery phrases. The copy of the text in WebAssembly memory is wiped.
    #[wasm_bindgen(js_name = fromLegacyPassphrase)]
    pub fn from_legacy_passphrase(
        profile: &ProfileHandle,
        passphrase: String,
    ) -> Result<KeyHandle> {
        let passphrase = Zeroizing::new(passphrase);
        KeyHandle::import_legacy(profile, &passphrase)
    }

    /// As [`KeyHandle::from_legacy_passphrase`], from the passphrase's UTF-8 bytes. The bytes are
    /// overwritten with zeros, in WebAssembly memory and in the caller's array.
    #[wasm_bindgen(js_name = fromLegacyPassphraseBytes)]
    pub fn from_legacy_passphrase_bytes(
        profile: &ProfileHandle,
        passphrase: &mut [u8],
    ) -> Result<KeyHandle> {
        let result = match std::str::from_utf8(passphrase) {
            Ok(text) => KeyHandle::import_legacy(profile, text),
            Err(_) => Err(BindingError::new(
                "InvalidPhrase",
                "the passphrase bytes are not UTF-8",
            )),
        };
        passphrase.zeroize();
        result
    }

    /// The compressed public key (33 bytes).
    #[wasm_bindgen(js_name = publicKey)]
    pub fn public_key(&self) -> Result<Vec<u8>> {
        Ok(self.account()?.public_key().as_bytes().to_vec())
    }

    /// The account's address on its profile's network.
    pub fn address(&self) -> Result<String> {
        Ok(self.account()?.address().to_string())
    }

    /// The signature algorithm, for example `secp256k1-bip340`.
    pub fn algorithm(&self) -> Result<String> {
        Ok(self.account()?.algorithm().as_str().to_owned())
    }

    /// The derivation path of a key from a recovery phrase, for example `m/44'/1'/0'/0'/0'`.
    #[wasm_bindgen(getter)]
    pub fn path(&self) -> Option<String> {
        self.path.clone()
    }

    /// Whether the key was imported from a legacy passphrase.
    #[wasm_bindgen(getter)]
    pub fn legacy(&self) -> bool {
        self.legacy
    }

    /// Whether the key was released.
    #[wasm_bindgen(getter)]
    pub fn released(&self) -> bool {
        self.account.is_none()
    }

    /// The message signature of `message`'s bytes on the account's network: BIP340 over their
    /// SHA-256, with fresh auxiliary randomness. JSON: `{ publicKey, signature, algorithm,
    /// network }`.
    #[wasm_bindgen(js_name = signMessage)]
    pub fn sign_message(&self, message: &[u8]) -> Result<String> {
        self.sign(message, Aux::random())
    }

    /// Wipes the secret key. Every later call that needs the key fails with `KeyReleased`.
    pub fn release(&mut self) {
        // Dropping the account overwrites the secret key's bytes.
        self.account = None;
    }
}

/// Reproducible signatures, in test builds only.
#[cfg(feature = "fixed-aux")]
#[wasm_bindgen]
impl KeyHandle {
    /// As [`KeyHandle::sign_message`], with these 32 auxiliary bytes instead of random ones.
    #[wasm_bindgen(js_name = signMessageWithAux)]
    pub fn sign_message_with_aux(&self, message: &[u8], aux: &[u8]) -> Result<String> {
        self.sign(message, crate::draft::fixed_aux(aux)?)
    }
}

impl std::fmt::Debug for KeyHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never shows key material.
        f.debug_struct("KeyHandle")
            .field("legacy", &self.legacy)
            .field("released", &self.account.is_none())
            .finish_non_exhaustive()
    }
}

impl KeyHandle {
    fn from_mnemonic(
        profile: &ProfileHandle,
        mnemonic: &Mnemonic,
        account: u32,
        index: u32,
        passphrase: &str,
    ) -> Result<KeyHandle> {
        let options = AccountOptions {
            account,
            index,
            passphrase,
        };
        let account = Account::from_phrase(profile.profile(), mnemonic, &options)?;
        let path = match account.origin() {
            KeyOrigin::Phrase(path) => Some(path.to_string()),
            KeyOrigin::LegacyPassphrase => None,
        };
        Ok(KeyHandle {
            account: Some(account),
            profile: profile.profile().clone(),
            legacy: false,
            path,
        })
    }

    fn import_legacy(profile: &ProfileHandle, passphrase: &str) -> Result<KeyHandle> {
        let account = Account::from_legacy_passphrase(profile.profile(), passphrase)?;
        Ok(KeyHandle {
            account: Some(account),
            profile: profile.profile().clone(),
            legacy: true,
            path: None,
        })
    }

    /// The account, unless it was released.
    pub(crate) fn account(&self) -> Result<&Account> {
        self.account
            .as_ref()
            .ok_or_else(|| BindingError::from(iceroot_sdk::Error::KeyReleased))
    }

    fn sign(&self, message: &[u8], aux: Aux) -> Result<String> {
        let MessageSignature {
            public_key,
            signature,
            algorithm,
            network,
        } = message::sign_bytes_with(&self.profile, self.account()?, message, aux)?;
        Ok(json!({
            "publicKey": public_key,
            "signature": signature,
            "algorithm": algorithm,
            "network": network,
        })
        .to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PUBLIC_KEY: &str = "03f83f83227e28add5598d2c75c20f72b4bfb0328957ef27e2da2ff73779fa4bd2";
    const ADDRESS: &str = "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF";
    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

    fn devnet() -> ProfileHandle {
        ProfileHandle::from_json(
            r#"{"id":"devnet","backend":"solar-compat","api":{"relays":["http://127.0.0.1:4003/api"]},"chain":{"networkByte":90},"keyScheme":"bip32-secp256k1"}"#,
        )
        .unwrap()
    }

    #[test]
    fn legacy_passphrase() {
        let key =
            KeyHandle::from_legacy_passphrase(&devnet(), "probe passphrase".to_owned()).unwrap();
        assert!(key.legacy());
        assert_eq!(key.path(), None);
        assert_eq!(hex::encode(key.public_key().unwrap()), PUBLIC_KEY);
        assert_eq!(key.address().unwrap(), ADDRESS);

        let mut bytes = b"probe passphrase".to_vec();
        let from_bytes = KeyHandle::from_legacy_passphrase_bytes(&devnet(), &mut bytes).unwrap();
        assert_eq!(from_bytes.address().unwrap(), ADDRESS);
        assert!(bytes.iter().all(|&byte| byte == 0));

        let mut invalid = vec![0xff, 0xfe];
        let error = KeyHandle::from_legacy_passphrase_bytes(&devnet(), &mut invalid).unwrap_err();
        assert_eq!(error.code(), "InvalidPhrase");
        assert_eq!(invalid, [0, 0]);
    }

    #[test]
    fn phrases() {
        let first =
            KeyHandle::from_phrase(&devnet(), PHRASE.to_owned(), 0, 0, String::new()).unwrap();
        assert!(!first.legacy());
        assert_eq!(first.path().as_deref(), Some("m/44'/1'/0'/0'/0'"));
        let mut bytes = PHRASE.as_bytes().to_vec();
        let again =
            KeyHandle::from_phrase_bytes(&devnet(), &mut bytes, 0, 0, String::new()).unwrap();
        assert_eq!(again.address().unwrap(), first.address().unwrap());
        assert!(bytes.iter().all(|&byte| byte == 0));
        let second =
            KeyHandle::from_phrase(&devnet(), PHRASE.to_owned(), 0, 1, String::new()).unwrap();
        assert_ne!(second.address().unwrap(), first.address().unwrap());
        let with_passphrase =
            KeyHandle::from_phrase(&devnet(), PHRASE.to_owned(), 0, 0, "x".to_owned()).unwrap();
        assert_ne!(with_passphrase.address().unwrap(), first.address().unwrap());

        let short = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let error =
            KeyHandle::from_phrase(&devnet(), short.to_owned(), 0, 0, String::new()).unwrap_err();
        assert_eq!(error.code(), "PhraseTooShort");
        let error = KeyHandle::from_phrase(&devnet(), PHRASE.to_owned(), 1 << 31, 0, String::new())
            .unwrap_err();
        assert_eq!(error.code(), "InvalidPath");
    }

    #[test]
    fn sign_and_release() {
        let mut key =
            KeyHandle::from_legacy_passphrase(&devnet(), "probe passphrase".to_owned()).unwrap();
        let message = b"IceRoot sign-in test";
        let signed: serde_json::Value =
            serde_json::from_str(&key.sign_message(message).unwrap()).unwrap();
        assert_eq!(signed["network"], "heartwood-devnet-v90");
        assert_eq!(signed["publicKey"], PUBLIC_KEY);
        assert!(crate::messages::verify_message(
            message,
            PUBLIC_KEY,
            signed["signature"].as_str().unwrap(),
            "secp256k1-bip340-sha256"
        ));

        key.release();
        assert!(key.released());
        assert_eq!(key.sign_message(message).unwrap_err().code(), "KeyReleased");
        assert_eq!(key.address().unwrap_err().code(), "KeyReleased");
    }

    #[cfg(feature = "fixed-aux")]
    #[test]
    fn fixed_aux_matches_the_probe() {
        let key =
            KeyHandle::from_legacy_passphrase(&devnet(), "probe passphrase".to_owned()).unwrap();
        let signed: serde_json::Value = serde_json::from_str(
            &key.sign_message_with_aux(b"IceRoot sign-in test", &[7; 32])
                .unwrap(),
        )
        .unwrap();
        let hex = signed["signature"].as_str().unwrap();
        assert!(hex.starts_with("a2ca2893"), "{hex}");
        assert!(hex.ends_with("aeba5518f"), "{hex}");
        assert_eq!(
            key.sign_message_with_aux(b"x", &[7; 31])
                .unwrap_err()
                .code(),
            "InvalidArgument"
        );
    }
}
