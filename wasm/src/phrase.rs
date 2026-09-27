//! Recovery phrases.
//!
//! A phrase is secret, so no copy of it is left behind in WebAssembly memory: the phrases these
//! functions take are owned strings that are wiped when the call ends, and a new phrase goes to
//! JavaScript straight from the core's wiped buffer.

use iceroot_sdk_bindings::phrase;
use js_sys::JsString;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::Result;

/// A new 24-word recovery phrase from 256 bits of `crypto.getRandomValues`. The JavaScript string
/// is made from the core's own copy, which is wiped when the call returns.
#[wasm_bindgen(js_name = generatePhrase)]
pub fn generate_phrase() -> Result<JsString> {
    let mnemonic = phrase::generate_phrase()?;
    Ok(JsString::from(mnemonic.phrase()))
}

/// What is wrong with `text` as a recovery phrase for keys, for feedback while it is typed. JSON:
/// `{ ok, words, reason?, position? }`, where the reason is `empty`, `not-text`, `unknown-word`
/// (with the 1-based position of the word), `word-count`, `too-short` or `checksum`. No word of
/// the phrase is ever repeated. The copy of `text` in WebAssembly memory is wiped.
#[wasm_bindgen(js_name = checkPhrase)]
pub fn check_phrase(text: String) -> String {
    phrase::check_phrase(text)
}
