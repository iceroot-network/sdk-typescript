//! Errors that cross the boundary.
//!
//! A [`BindingError`] becomes a JavaScript `Error` whose `name` is the error code and whose
//! `details` object carries the structured fields. Errors of the core keep the core's code and
//! details exactly; the bindings add only `InvalidArgument`, for a call whose arguments do not
//! have the documented shape, and raise the core's `InvalidProfile` for a profile they cannot
//! read. The TypeScript wrapper maps every code to its own error classes, so the codes are part of
//! the contract between the two halves.

use iceroot_sdk::Error;
use serde_json::{Value, json};
use wasm_bindgen::JsValue;

/// An error with a stable code, a message and structured details.
#[derive(Debug, Clone, PartialEq)]
pub struct BindingError {
    code: &'static str,
    message: String,
    details: Value,
}

impl BindingError {
    /// An error with `code`, `message` and no details.
    pub fn new(code: &'static str, message: impl Into<String>) -> BindingError {
        BindingError {
            code,
            message: message.into(),
            details: json!({}),
        }
    }

    /// A call whose arguments do not have the documented shape.
    pub fn argument(message: impl Into<String>) -> BindingError {
        BindingError::new("InvalidArgument", message)
    }

    /// A network profile the bindings cannot use.
    pub fn profile(message: impl Into<String>) -> BindingError {
        BindingError::new("InvalidProfile", message)
    }

    /// The stable code.
    pub fn code(&self) -> &'static str {
        self.code
    }

    /// The human-readable message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// The structured details, a JSON object.
    pub fn details(&self) -> &Value {
        &self.details
    }
}

impl From<Error> for BindingError {
    fn from(error: Error) -> BindingError {
        BindingError {
            code: error.code().as_str(),
            message: error.to_string(),
            details: error.details(),
        }
    }
}

impl From<BindingError> for JsValue {
    fn from(error: BindingError) -> JsValue {
        let js_error = js_sys::Error::new(&error.message);
        js_error.set_name(error.code);
        // The details are a JSON object the SDK made, so parsing cannot fail; a failure would only
        // drop the details, never the error itself.
        let details = js_sys::JSON::parse(&error.details.to_string())
            .unwrap_or_else(|_| js_sys::Object::new().into());
        let _ = js_sys::Reflect::set(&js_error, &JsValue::from_str("details"), &details);
        js_error.into()
    }
}

/// The result type of every fallible binding.
pub type Result<T> = std::result::Result<T, BindingError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_errors_keep_their_code_and_details() {
        let error = BindingError::from(Error::PhraseTooShort {
            words: 12,
            minimum: 18,
        });
        assert_eq!(error.code(), "PhraseTooShort");
        assert_eq!(error.details(), &json!({ "words": 12, "minimum": 18 }));
        assert_eq!(BindingError::argument("x").code(), "InvalidArgument");
        assert_eq!(BindingError::profile("x").details(), &json!({}));
    }
}
