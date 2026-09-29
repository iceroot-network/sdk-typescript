//! Drafts and signed transactions.
//!
//! A draft is built from an operation and the facts a node reported, checked against every rule
//! of the milestone in force, and signed as a separate step. Drafts and signed transactions
//! serialize to bytes, so a draft can be built where the network is and signed where the key is.

use iceroot_sdk::{Aux, Draft, SignedTransaction};
use iceroot_sdk_bindings::draft;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::chain::ChainHandle;
use crate::error::Result;
use crate::keys::KeyHandle;
use crate::profile::ProfileHandle;

/// A draft of the core: a transaction built and checked, ready to sign.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct DraftHandle {
    draft: Draft,
}

#[wasm_bindgen]
impl DraftHandle {
    /// The draft of `request` on `chain`, with the `facts` the node reported.
    ///
    /// - `request`: `{ operation, memo?, fee? }`. The operation is one of
    ///   `{ kind: "transfer", to: [{ address, amount }] }`, `{ kind: "vote", entries: [{ validator,
    ///   basisPoints }] }`, `{ kind: "burn", amount }`, `{ kind: "register-second-key", publicKey }`,
    ///   `{ kind: "register-validator", name }` and `{ kind: "resign-validator", resignation }` (
    ///   `temporary`, `permanent` or `revoke`). The fee is `{ kind: "minimum" }` (the default),
    ///   `{ kind: "exact", amount }` or `{ kind: "multiplier", basisPoints }`; the minimum and its
    ///   multiples fail with `FeeUnavailable` where no fee floor is in force.
    /// - `facts`: `{ sender, nonce, height, secondKey? }`, keys as hex.
    ///
    /// Amounts and the nonce are decimal strings.
    pub fn build(chain: &ChainHandle, request: &str, facts: &str) -> Result<DraftHandle> {
        draft::build(chain.chain(), request, facts).map(|draft| DraftHandle { draft })
    }

    /// The draft in `bytes` (from [`DraftHandle::serialize`]), for `profile`, whose network hash
    /// must be pinned. A draft for another profile or network is refused, and the summary is
    /// computed again from the transaction's own fields. The floor is that of the configuration
    /// the draft carries, so a fee at it reads `unverified`, never `floor`.
    pub fn deserialize(bytes: &[u8], profile: &ProfileHandle) -> Result<DraftHandle> {
        draft::deserialize(bytes, profile.profile()).map(|draft| DraftHandle { draft })
    }

    /// The draft in `bytes` (from [`DraftHandle::serialize`]), read on `chain`, the chain of the
    /// reader's own connection: a draft built under another network configuration is refused
    /// with `NetworkMismatch`, and the floor, the rules and the labels come from `chain`, so a fee
    /// at the floor reads `floor`.
    #[wasm_bindgen(js_name = deserializeOn)]
    pub fn deserialize_on(bytes: &[u8], chain: &ChainHandle) -> Result<DraftHandle> {
        draft::deserialize_on(bytes, chain.chain()).map(|draft| DraftHandle { draft })
    }

    /// Everything a review screen shows, in JSON: `{ profile, networkByte, nethash, height, kind,
    /// operation, from, publicKey, nonce, fee: { amount, source, floor }, memo, amount, size,
    /// secondSignature }`.
    pub fn summary(&self) -> String {
        draft::summary(&self.draft)
    }

    /// The unsigned bytes: what the sender's key signs, after SHA-256.
    #[wasm_bindgen(js_name = unsignedBytes)]
    pub fn unsigned_bytes(&self) -> Vec<u8> {
        self.draft.unsigned_bytes().to_vec()
    }

    /// The chain the draft is for.
    pub fn chain(&self) -> ChainHandle {
        ChainHandle::of(self.draft.chain().clone())
    }

    /// The draft as bytes, for signing in another context: versioned, with the profile id, the
    /// network's identity and configuration, the height and the unsigned transaction.
    pub fn serialize(&self) -> Vec<u8> {
        self.draft.serialize()
    }

    /// Signs with the sender's key, with fresh randomness.
    pub fn sign(&self, key: &KeyHandle) -> Result<SignedHandle> {
        self.sign_all(key, None, Aux::random())
    }

    /// Signs with the sender's key and its registered second key, with fresh randomness.
    #[wasm_bindgen(js_name = signWithSecond)]
    pub fn sign_with_second(&self, key: &KeyHandle, second: &KeyHandle) -> Result<SignedHandle> {
        self.sign_all(key, Some(second), Aux::random())
    }
}

/// Reproducible signatures, in test builds only.
#[cfg(feature = "fixed-aux")]
#[wasm_bindgen]
impl DraftHandle {
    /// As [`DraftHandle::sign`], with these 32 auxiliary bytes instead of random ones.
    #[wasm_bindgen(js_name = signWithAux)]
    pub fn sign_with_aux(&self, key: &KeyHandle, aux: &[u8]) -> Result<SignedHandle> {
        self.sign_all(key, None, draft::fixed_aux(aux)?)
    }

    /// As [`DraftHandle::sign_with_second`], with these 32 auxiliary bytes for both signatures.
    #[wasm_bindgen(js_name = signWithSecondAux)]
    pub fn sign_with_second_aux(
        &self,
        key: &KeyHandle,
        second: &KeyHandle,
        aux: &[u8],
    ) -> Result<SignedHandle> {
        self.sign_all(key, Some(second), draft::fixed_aux(aux)?)
    }
}

impl DraftHandle {
    fn sign_all(
        &self,
        key: &KeyHandle,
        second: Option<&KeyHandle>,
        aux: Aux,
    ) -> Result<SignedHandle> {
        draft::sign(&self.draft, key.key(), second.map(KeyHandle::key), aux)
            .map(|signed| SignedHandle { signed })
    }
}

/// A signed transaction of the core, with its id, bytes and JSON.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct SignedHandle {
    signed: SignedTransaction,
}

#[wasm_bindgen]
impl SignedHandle {
    /// The signed transaction in `bytes` (from [`SignedHandle::serialize`]), for `profile`, whose
    /// network hash must be pinned. It must verify.
    pub fn deserialize(bytes: &[u8], profile: &ProfileHandle) -> Result<SignedHandle> {
        draft::signed_deserialize(bytes, profile.profile()).map(|signed| SignedHandle { signed })
    }

    /// The transaction in the node's JSON form, read and checked under the rules of `chain` at
    /// `height`. A bad signature does not refuse it: `verified` is then false.
    #[wasm_bindgen(js_name = fromJson)]
    pub fn from_json(chain: &ChainHandle, json: &str, height: u32) -> Result<SignedHandle> {
        draft::signed_from_json(chain.chain(), json, height).map(|signed| SignedHandle { signed })
    }

    /// The transaction in `bytes`, as a node sends them, read and checked under the rules of
    /// `chain` at `height`. A bad signature does not refuse it: `verified` is then false.
    pub fn decode(chain: &ChainHandle, bytes: &[u8], height: u32) -> Result<SignedHandle> {
        draft::signed_decode(chain.chain(), bytes, height).map(|signed| SignedHandle { signed })
    }

    /// The id: 64 lowercase hex digits.
    pub fn id(&self) -> String {
        self.signed.id()
    }

    /// The signed bytes, as sent to a node.
    pub fn bytes(&self) -> Vec<u8> {
        self.signed.bytes().to_vec()
    }

    /// The transaction in the JSON form a node accepts and returns.
    pub fn json(&self) -> String {
        self.signed.json().to_string()
    }

    /// Whether the sender's signature verifies.
    #[wasm_bindgen(getter)]
    pub fn verified(&self) -> bool {
        self.signed.is_verified()
    }

    /// Whether the second signature verifies for `public_key` (hex).
    #[wasm_bindgen(js_name = verifySecondSignature)]
    pub fn verify_second_signature(&self, public_key: &str) -> bool {
        draft::verify_second_signature(&self.signed, public_key)
    }

    /// What the transaction does, in JSON: `{ id, kind, operation, from, publicKey, nonce, fee,
    /// memo, amount, size, height, secondSignature }`.
    pub fn summary(&self) -> String {
        draft::signed_summary(&self.signed)
    }

    /// The transaction as bytes, for the trip back from the context that signed it.
    pub fn serialize(&self) -> Vec<u8> {
        self.signed.serialize()
    }
}

impl SignedHandle {
    /// The core's signed transaction.
    pub(crate) fn signed(&self) -> &SignedTransaction {
        &self.signed
    }
}

/// The facts of a draft by `sender` (a public key as hex) on `chain`, from what the node reported:
/// the sender's account (as [`crate::api::ApiCall::decode`] writes it; `undefined` when the node
/// does not know the address yet) and the node's status (likewise). Returns the facts
/// [`DraftHandle::build`] takes, in JSON: `{ sender, nonce, height, secondKey }`, the nonce being
/// the account's plus one and the height the next block's.
///
/// The account must be the sender's (the same address, and the same public key when the node
/// knows one), else the draft would take another account's nonce: that is refused with
/// `WrongKey`.
#[wasm_bindgen(js_name = onlineFacts)]
pub fn online_facts(
    chain: &ChainHandle,
    sender: &str,
    account: Option<String>,
    status: &str,
) -> Result<String> {
    draft::online_facts(chain.chain(), sender, account.as_deref(), status)
}
