//! Accounts whose secret keys are held in WebAssembly memory.

use iceroot_sdk::Aux;
use iceroot_sdk_bindings::keys::Key;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::Result;
use crate::profile::ProfileHandle;

/// An account of the core: a secret key, its public key and address, and the profile it belongs
/// to. The secret never leaves WebAssembly memory.
///
/// [`KeyHandle::release`] wipes the key; dropping the handle (`free()` in JavaScript, or garbage
/// collection) wipes it too.
#[wasm_bindgen]
#[derive(Debug)]
pub struct KeyHandle {
    key: Key,
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
        Key::from_phrase(profile.profile(), phrase, account, index, passphrase)
            .map(|key| KeyHandle { key })
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
        Key::from_phrase_bytes(profile.profile(), phrase, account, index, passphrase)
            .map(|key| KeyHandle { key })
    }

    /// The account at `account` and `index` of the recovery phrase the keystore `keystore` holds,
    /// opened with `password` (UTF-8 bytes, overwritten with zeros in WebAssembly memory and in the
    /// caller's array, whatever the outcome), with the optional BIP39 `passphrase`, whose copy is
    /// wiped. The phrase is decrypted and the key derived in WebAssembly memory: the phrase never
    /// reaches JavaScript. `max_memory_kib` lowers the memory the keystore may ask for.
    #[wasm_bindgen(js_name = fromKeystore)]
    pub fn from_keystore(
        profile: &ProfileHandle,
        keystore: &[u8],
        password: &mut [u8],
        account: u32,
        index: u32,
        passphrase: String,
        max_memory_kib: Option<u32>,
    ) -> Result<KeyHandle> {
        Key::from_keystore(
            profile.profile(),
            keystore,
            password,
            account,
            index,
            passphrase,
            max_memory_kib,
        )
        .map(|key| KeyHandle { key })
    }

    /// The reference implementation's passphrase key: the SHA-256 of the passphrase's UTF-8
    /// bytes. For importing existing devnet identities only, on profiles in today's formats; new
    /// accounts come from recovery phrases. The copy of the text in WebAssembly memory is wiped.
    #[wasm_bindgen(js_name = fromLegacyPassphrase)]
    pub fn from_legacy_passphrase(
        profile: &ProfileHandle,
        passphrase: String,
    ) -> Result<KeyHandle> {
        Key::from_legacy_passphrase(profile.profile(), passphrase).map(|key| KeyHandle { key })
    }

    /// As [`KeyHandle::from_legacy_passphrase`], from the passphrase's UTF-8 bytes. The bytes are
    /// overwritten with zeros, in WebAssembly memory and in the caller's array.
    #[wasm_bindgen(js_name = fromLegacyPassphraseBytes)]
    pub fn from_legacy_passphrase_bytes(
        profile: &ProfileHandle,
        passphrase: &mut [u8],
    ) -> Result<KeyHandle> {
        Key::from_legacy_passphrase_bytes(profile.profile(), passphrase)
            .map(|key| KeyHandle { key })
    }

    /// The compressed public key (33 bytes).
    #[wasm_bindgen(js_name = publicKey)]
    pub fn public_key(&self) -> Result<Vec<u8>> {
        self.key.public_key()
    }

    /// The account's address on its profile's network.
    pub fn address(&self) -> Result<String> {
        self.key.address()
    }

    /// The signature algorithm, for example `secp256k1-bip340`.
    pub fn algorithm(&self) -> Result<String> {
        self.key.algorithm()
    }

    /// The derivation path of a key from a recovery phrase, for example `m/44'/1'/0'/0'/0'`.
    #[wasm_bindgen(getter)]
    pub fn path(&self) -> Option<String> {
        self.key.path()
    }

    /// Whether the key was imported from a legacy passphrase.
    #[wasm_bindgen(getter)]
    pub fn legacy(&self) -> bool {
        self.key.legacy()
    }

    /// Whether the key was released.
    #[wasm_bindgen(getter)]
    pub fn released(&self) -> bool {
        self.key.released()
    }

    /// The message signature of `message`'s bytes on the account's network: BIP340 over their
    /// SHA-256, with fresh auxiliary randomness. JSON: `{ publicKey, signature, algorithm,
    /// network }`.
    #[wasm_bindgen(js_name = signMessage)]
    pub fn sign_message(&self, message: &[u8]) -> Result<String> {
        self.key.sign_message_with(message, Aux::random())
    }

    /// The signature of the sign-in `message`, for the website of `origin` (the origin of the page
    /// that asks, as the browser reports it), at `now_ms` (milliseconds since
    /// 1970-01-01T00:00:00Z), with fresh auxiliary randomness. The message is checked first, as
    /// `parseSignIn` checks it, against that origin and this account's own public key and address,
    /// and signed only if every check passes. JSON as [`KeyHandle::sign_message`]; a refusal is
    /// `InvalidSignIn` with the reason.
    #[wasm_bindgen(js_name = signSignIn)]
    pub fn sign_sign_in(&self, message: &str, origin: &str, now_ms: f64) -> Result<String> {
        self.key
            .sign_sign_in_with(message, origin, now_ms, Aux::random())
    }

    /// Wipes the secret key. Every later call that needs the key fails with `KeyReleased`.
    pub fn release(&mut self) {
        self.key.release();
    }
}

/// Reproducible signatures, in test builds only.
#[cfg(feature = "fixed-aux")]
#[wasm_bindgen]
impl KeyHandle {
    /// As [`KeyHandle::sign_message`], with these 32 auxiliary bytes instead of random ones.
    #[wasm_bindgen(js_name = signMessageWithAux)]
    pub fn sign_message_with_aux(&self, message: &[u8], aux: &[u8]) -> Result<String> {
        let aux = iceroot_sdk_bindings::draft::fixed_aux(aux)?;
        self.key.sign_message_with(message, aux)
    }
}

impl KeyHandle {
    /// The key.
    pub(crate) fn key(&self) -> &Key {
        &self.key
    }
}
