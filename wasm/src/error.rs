//! Errors that cross the boundary.
//!
//! A [`BindingError`] becomes a JavaScript `Error` whose `name` is the error code and whose
//! `details` object carries the structured fields. The TypeScript wrapper maps the code to its own
//! error classes, so the codes below are part of the contract between the two halves.

use wasm_bindgen::JsValue;

/// The stable code of a [`BindingError`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    /// A passphrase or recovery phrase was refused.
    InvalidPhrase,
    /// An address was refused; the details carry the reason.
    InvalidAddress,
    /// A public key was refused.
    InvalidPublicKey,
    /// The auxiliary bytes of a test signature were not 32 bytes.
    InvalidAux,
    /// No random bytes were available for signing.
    RandomnessUnavailable,
    /// No signature exists for this key and message.
    SigningFailed,
    /// The key was released and can no longer sign.
    KeyReleased,
}

impl ErrorCode {
    /// The code as the wrapper sees it.
    pub const fn as_str(self) -> &'static str {
        match self {
            ErrorCode::InvalidPhrase => "InvalidPhrase",
            ErrorCode::InvalidAddress => "InvalidAddress",
            ErrorCode::InvalidPublicKey => "InvalidPublicKey",
            ErrorCode::InvalidAux => "InvalidAux",
            ErrorCode::RandomnessUnavailable => "RandomnessUnavailable",
            ErrorCode::SigningFailed => "SigningFailed",
            ErrorCode::KeyReleased => "KeyReleased",
        }
    }
}

/// Why an address was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressReason {
    /// The checksum does not match.
    Checksum,
    /// The decoded payload has the wrong length.
    Length,
    /// The address belongs to another network.
    WrongNetwork,
    /// The text is not Base58.
    Format,
}

impl AddressReason {
    /// The reason as the wrapper sees it.
    pub const fn as_str(self) -> &'static str {
        match self {
            AddressReason::Checksum => "checksum",
            AddressReason::Length => "length",
            AddressReason::WrongNetwork => "wrong-network",
            AddressReason::Format => "format",
        }
    }
}

/// An error with a stable code, a message and optional structured details.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingError {
    code: ErrorCode,
    message: String,
    reason: Option<AddressReason>,
    position: Option<u32>,
}

impl BindingError {
    /// An error with `code` and `message` and no details.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> BindingError {
        BindingError {
            code,
            message: message.into(),
            reason: None,
            position: None,
        }
    }

    /// An address error with its reason and, when known, the position of the offending character.
    pub fn address(
        reason: AddressReason,
        position: Option<u32>,
        message: impl Into<String>,
    ) -> BindingError {
        BindingError {
            code: ErrorCode::InvalidAddress,
            message: message.into(),
            reason: Some(reason),
            position,
        }
    }

    /// The code.
    pub const fn code(&self) -> ErrorCode {
        self.code
    }

    /// The human-readable message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// The reason of an address error.
    pub const fn reason(&self) -> Option<AddressReason> {
        self.reason
    }

    /// The position of the offending character of an address error.
    pub const fn position(&self) -> Option<u32> {
        self.position
    }
}

impl From<BindingError> for JsValue {
    fn from(error: BindingError) -> JsValue {
        let js_error = js_sys::Error::new(&error.message);
        js_error.set_name(error.code.as_str());
        let details = js_sys::Object::new();
        // Setting a property on a fresh plain object cannot fail; a failure would only drop a
        // detail, never the error itself.
        if let Some(reason) = error.reason {
            let _ = js_sys::Reflect::set(
                &details,
                &JsValue::from_str("reason"),
                &JsValue::from_str(reason.as_str()),
            );
        }
        if let Some(position) = error.position {
            let _ = js_sys::Reflect::set(
                &details,
                &JsValue::from_str("position"),
                &JsValue::from(position),
            );
        }
        let _ = js_sys::Reflect::set(&js_error, &JsValue::from_str("details"), &details);
        js_error.into()
    }
}
