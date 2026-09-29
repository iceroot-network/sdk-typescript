//! The keystore: a recovery phrase's entropy encrypted under a password with Argon2id and
//! XChaCha20-Poly1305, in the versioned format of the SDK's `iceroot-keystore` crate. Nothing is
//! stored here; the app keeps the bytes (or their text form) where its platform keeps secrets.
//!
//! Secrets cross the boundary as UTF-8 bytes in the caller's own arrays: a phrase and every
//! password are overwritten with zeros, in WebAssembly memory and in the caller's array, whatever
//! the outcome. A decrypted phrase goes to JavaScript as a new byte array made straight from the
//! core's wiped buffer; what the decryption and the phrase's checksum leave on the stack (the
//! entropy among it) is overwritten by the wrapper's [`wipe_stack`](crate::wipe_stack) after the
//! call, so no other copy of it is left in WebAssembly memory.
//!
//! The functions, their arguments and their refusals are those of the shared bindings' `keystore`
//! module.

use iceroot_sdk_bindings::keystore;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::Result;

/// A new keystore of the recovery phrase in `phrase` (UTF-8 bytes of 18, 21 or 24 BIP39 English
/// words) under `password` (UTF-8 bytes), with `params` in JSON: `{ memoryKib, iterations,
/// parallelism }`, a platform's preset or the app's own. The salt and nonce are fresh
/// from `crypto.getRandomValues`. Both arrays are overwritten with zeros.
#[wasm_bindgen(js_name = keystoreEncrypt)]
pub fn keystore_encrypt(phrase: &mut [u8], password: &mut [u8], params: &str) -> Result<Vec<u8>> {
    keystore::keystore_encrypt(phrase, password, params)
}

/// Decrypts a keystore with `password` (UTF-8 bytes, overwritten with zeros) and gives back the
/// recovery phrase it holds (the payload kind `bip39-entropy`, the only one this release opens):
/// a new array of the canonical phrase's UTF-8 bytes, its words joined by single spaces.
/// `maxMemoryKib` lowers the memory a keystore may ask for, on a platform that cannot spare the
/// format's ceiling.
#[wasm_bindgen(js_name = keystoreDecrypt)]
pub fn keystore_decrypt(
    keystore: &[u8],
    password: &mut [u8],
    max_memory_kib: Option<u32>,
) -> Result<js_sys::Uint8Array> {
    let mnemonic = keystore::keystore_decrypt(keystore, password, max_memory_kib)?;
    // Made straight from the phrase's wiped buffer.
    Ok(js_sys::Uint8Array::from(mnemonic.phrase().as_bytes()))
}

/// The header of a keystore, read without the password, in JSON: `{ version, kdf, memoryKib,
/// iterations, parallelism, salt, nonce, payloadKind, payloadLength, keystoreLength }`.
#[wasm_bindgen(js_name = keystoreInspect)]
pub fn keystore_inspect(keystore: &[u8]) -> Result<String> {
    keystore::keystore_inspect(keystore)
}

/// The keystore encrypted again under `new_password` with `params`, a fresh salt and a fresh
/// nonce, once `old_password` opens it. Both password arrays are overwritten with zeros.
/// `maxMemoryKib` lowers the memory ceiling as for [`keystore_decrypt`]: the new parameters are
/// checked and the old keystore opened under it, so a keystore or parameters that ask for more
/// are refused with `ParamsOutOfRange` before any key derivation.
#[wasm_bindgen(js_name = keystoreChangePassword)]
pub fn keystore_change_password(
    keystore: &[u8],
    old_password: &mut [u8],
    new_password: &mut [u8],
    params: &str,
    max_memory_kib: Option<u32>,
) -> Result<Vec<u8>> {
    keystore::keystore_change_password_with_bounds(
        keystore,
        old_password,
        new_password,
        params,
        max_memory_kib,
    )
}

/// The keystore encrypted again under the same password with new `params`, a fresh salt and a
/// fresh nonce: for moving it to a newer preset after an unlock. The password array is
/// overwritten with zeros. `maxMemoryKib` as for [`keystore_change_password`].
#[wasm_bindgen(js_name = keystoreReencrypt)]
pub fn keystore_reencrypt(
    keystore: &[u8],
    password: &mut [u8],
    params: &str,
    max_memory_kib: Option<u32>,
) -> Result<Vec<u8>> {
    keystore::keystore_reencrypt_with_bounds(keystore, password, params, max_memory_kib)
}

/// The text form of a keystore: `irks:` and the bytes in unpadded base64url.
#[wasm_bindgen(js_name = keystoreArmor)]
pub fn keystore_armor(keystore: &[u8]) -> String {
    keystore::keystore_armor(keystore)
}

/// The bytes of a keystore's text form.
#[wasm_bindgen(js_name = keystoreDearmor)]
pub fn keystore_dearmor(text: &str) -> Result<Vec<u8>> {
    keystore::keystore_dearmor(text)
}

/// Checks `params` (as [`keystore_encrypt`] takes them) against the format's bounds, with the
/// memory ceiling lowered to `maxMemoryKib` when given: `ParamsOutOfRange` naming the first
/// parameter out of range, or nothing.
#[wasm_bindgen(js_name = keystoreCheckParams)]
pub fn keystore_check_params(params: &str, max_memory_kib: Option<u32>) -> Result<()> {
    keystore::keystore_check_params(params, max_memory_kib)
}

/// Whether a keystore written with `params` should be encrypted again with `than`, the parameters
/// an app writes now: less memory, or the same memory and fewer passes. A keystore never moves to
/// less memory.
#[wasm_bindgen(js_name = keystoreIsWeaker)]
pub fn keystore_is_weaker(params: &str, than: &str) -> Result<bool> {
    keystore::keystore_is_weaker(params, than)
}

/// Test seam of the bindings only (feature `keystore-testing`, which the test build of the package
/// turns on and the published build never does): the keystore vectors' own salt, nonce and lowered
/// bounds, so that every record of the vectors runs in WebAssembly.
#[cfg(feature = "keystore-testing")]
mod testing {
    use super::*;
    use iceroot_sdk_bindings::keystore::testing;

    /// The format's constants, in JSON: `{ presets: { desktop, mobile, web }, bounds: { floor,
    /// ceiling, maxWork }, maxPasswordBytes, armorPrefix, headerLength }`.
    #[wasm_bindgen(js_name = keystoreConstants)]
    pub fn keystore_constants() -> String {
        testing::keystore_constants()
    }

    /// A keystore of `secret` of payload kind `kind` (`bip39-entropy` or `ml-dsa-65-seed`) with
    /// the given salt and nonce, under `bounds` (`standard` or `test`).
    #[wasm_bindgen(js_name = keystoreEncryptWithSaltAndNonce)]
    pub fn keystore_encrypt_with_salt_and_nonce(
        kind: &str,
        secret: &[u8],
        password: &str,
        params: &str,
        salt: &[u8],
        nonce: &[u8],
        bounds: &str,
    ) -> Result<Vec<u8>> {
        testing::keystore_encrypt_with_salt_and_nonce(
            kind, secret, password, params, salt, nonce, bounds,
        )
    }

    /// The payload of a keystore under `bounds`, in the vectors' JSON: `{ kind, secret,
    /// wordCount }`, the secret in hex.
    #[wasm_bindgen(js_name = keystoreDecryptWithBounds)]
    pub fn keystore_decrypt_with_bounds(
        keystore: &[u8],
        password: &str,
        bounds: &str,
    ) -> Result<String> {
        testing::keystore_decrypt_with_bounds(keystore, password, bounds)
    }

    /// Checks `params` against `bounds`.
    #[wasm_bindgen(js_name = keystoreCheckParamsWithBounds)]
    pub fn keystore_check_params_with_bounds(params: &str, bounds: &str) -> Result<()> {
        testing::keystore_check_params_with_bounds(params, bounds)
    }
}
