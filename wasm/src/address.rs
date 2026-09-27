//! S1 addresses: network byte and RIPEMD-160 of the key, in Base58Check.

use heartwood_crypto::errors::{AddressError, Base58Error};
use heartwood_crypto::{Address, PublicKey};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::{AddressReason, BindingError, ErrorCode};

/// The address of `public_key` (33 or 65 bytes) on the network with byte `network`.
#[wasm_bindgen(js_name = addressFromPublicKey)]
pub fn address_from_public_key(public_key: &[u8], network: u8) -> Result<String, BindingError> {
    let key = PublicKey::from_bytes(public_key).map_err(|_| {
        BindingError::new(
            ErrorCode::InvalidPublicKey,
            "the bytes are not a secp256k1 public key",
        )
    })?;
    Ok(Address::from_public_key(&key, network).to_base58())
}

/// The 21 bytes of the address in `text`, which must belong to the network with byte `network`.
///
/// The checks run in this order: Base58 characters, checksum, payload length, network byte.
#[wasm_bindgen(js_name = parseAddress)]
pub fn parse_address(text: &str, network: u8) -> Result<Vec<u8>, BindingError> {
    Address::from_base58_for(text, network)
        .map(|address| address.as_bytes().to_vec())
        .map_err(|error| address_error(text, error))
}

/// The binding error for `error`, with the reason the wrapper reports.
fn address_error(text: &str, error: AddressError) -> BindingError {
    match error {
        AddressError::Base58(Base58Error::InvalidCharacter { index }) => {
            // Every Base58 character is ASCII, so the index of the first bad character is the same
            // in bytes and in UTF-16 code units.
            let position = u32::try_from(index).ok();
            let shown = text
                .get(index..)
                .and_then(|rest| rest.chars().next())
                .map_or_else(String::new, |c| format!(" '{c}'"));
            BindingError::address(
                AddressReason::Format,
                position,
                format!("invalid character{shown} at position {index}"),
            )
        }
        AddressError::Base58(Base58Error::InvalidChecksum) => {
            BindingError::address(AddressReason::Checksum, None, "the checksum does not match")
        }
        AddressError::Base58(Base58Error::TooShort) => BindingError::address(
            AddressReason::Length,
            None,
            "the text is too short to be an address",
        ),
        AddressError::InvalidLength { actual } => BindingError::address(
            AddressReason::Length,
            None,
            format!("an address holds 21 bytes, this one holds {actual}"),
        ),
        AddressError::WrongNetwork { expected, actual } => BindingError::address(
            AddressReason::WrongNetwork,
            None,
            format!("the address is for network byte {actual}, expected {expected}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The key and address of the passphrase "probe passphrase" on network byte 90.
    const PUBLIC_KEY: &str = "03f83f83227e28add5598d2c75c20f72b4bfb0328957ef27e2da2ff73779fa4bd2";
    const ADDRESS: &str = "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF";

    #[test]
    fn from_public_key() {
        let key = hex::decode(PUBLIC_KEY).unwrap();
        assert_eq!(address_from_public_key(&key, 90).unwrap(), ADDRESS);
        let error = address_from_public_key(&key[..32], 90).unwrap_err();
        assert_eq!(error.code(), ErrorCode::InvalidPublicKey);
    }

    #[test]
    fn parse() {
        let bytes = parse_address(ADDRESS, 90).unwrap();
        assert_eq!(bytes.len(), 21);
        assert_eq!(bytes[0], 90);

        let wrong = parse_address(ADDRESS, 30).unwrap_err();
        assert_eq!(wrong.reason(), Some(AddressReason::WrongNetwork));

        let mut typo = ADDRESS.to_owned();
        typo.replace_range(5..6, "0");
        let format = parse_address(&typo, 90).unwrap_err();
        assert_eq!(format.reason(), Some(AddressReason::Format));
        assert_eq!(format.position(), Some(5));

        let mut swapped = ADDRESS.to_owned();
        swapped.replace_range(33..34, "G");
        let checksum = parse_address(&swapped, 90).unwrap_err();
        assert_eq!(checksum.reason(), Some(AddressReason::Checksum));

        // Three bytes hold no checksum; four zero bytes are an empty payload with a bad checksum.
        let short = parse_address("111", 90).unwrap_err();
        assert_eq!(short.reason(), Some(AddressReason::Length));
        let zeros = parse_address("1111", 90).unwrap_err();
        assert_eq!(zeros.reason(), Some(AddressReason::Checksum));
        let empty = parse_address("", 90).unwrap_err();
        assert_eq!(empty.reason(), Some(AddressReason::Length));
    }
}
