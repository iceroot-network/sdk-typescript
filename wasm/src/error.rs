//! Errors that cross the boundary.
//!
//! The shared bindings (`iceroot-sdk-bindings`) raise every failure as a [`BindingError`] with
//! the stable code and structured details of the crate that raised it, and with their feature
//! `wasm-bindgen` it becomes a JavaScript `Error` whose `name` is the error code and whose
//! `details` object carries the structured fields. The TypeScript wrapper maps every code to its
//! own error classes, so the codes are part of the contract between the two halves. The exports
//! return the bindings' results unchanged.

pub use iceroot_sdk_bindings::{BindingError, Result};
