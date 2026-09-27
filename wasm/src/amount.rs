//! Amounts: exact decimal text and base units, with no floating point anywhere.

use iceroot_sdk_bindings::amount;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::Result;

/// The base units of the decimal amount `text` of an asset with `decimals` fraction digits, as a
/// decimal string. More fraction digits than the asset has are refused with `InvalidAmount`.
#[wasm_bindgen(js_name = parseAmount)]
pub fn parse_amount(text: &str, decimals: u8) -> Result<String> {
    amount::parse_amount(text, decimals)
}

/// The base units `units` (a decimal string) as decimal text with `decimals` fraction digits.
/// `max_fraction` cuts further digits off, never rounding; `grouping` groups the whole part in
/// threes with commas.
#[wasm_bindgen(js_name = formatAmount)]
pub fn format_amount(
    units: &str,
    decimals: u8,
    max_fraction: Option<u8>,
    grouping: bool,
) -> Result<String> {
    amount::format_amount(units, decimals, max_fraction, grouping)
}
