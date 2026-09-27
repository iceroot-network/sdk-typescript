//! The node API client: requests built and answers decoded by the SDK's Rust client, as JSON.
//!
//! The client is sans-IO. [`ApiCall`] prepares one call of the Solar-compatible backend and gives
//! the request to send; the host performs it (with `fetch` in TypeScript) and hands the status,
//! headers and body back to [`ApiCall::decode`], which returns the answer in the JSON form every
//! binding of the SDK shares (the `serde` feature of `iceroot-sdk-api`: camel-case fields, 64-bit
//! and wider integers as decimal strings, absent values left out). [`SubmitPlanHandle`] splits a
//! submission into requests the pool accepts, and [`RequestBudgetHandle`] and [`backoff_delay`]
//! keep the host to the node's rate limit. The calls, their arguments and their answers are those
//! of the shared bindings' `api` module.

use iceroot_sdk_bindings::api::{self, Budget, PreparedCall, Submission};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::draft::SignedHandle;
use crate::error::Result;

/// One prepared call: the request to send and the decoder of its answer.
#[wasm_bindgen]
#[derive(Debug)]
pub struct ApiCall {
    call: PreparedCall,
}

#[wasm_bindgen]
impl ApiCall {
    /// Prepares `operation` of the Solar-compatible backend for a chain with `seats` validator
    /// seats, with its arguments `args` (a JSON object), as the shared bindings'
    /// `PreparedCall::prepare` documents them: every read of the node API client, from
    /// `nodeStatus` to `roundValidators`.
    pub fn prepare(seats: u32, operation: &str, args: &str) -> Result<ApiCall> {
        PreparedCall::prepare(seats, operation, args).map(|call| ApiCall { call })
    }

    /// The request to send, in JSON: `{ method, path, query, body?, target, headers }`. `target`
    /// is the path with its encoded query string, to append to the relay URL; `headers` are the
    /// headers the request needs, as `[name, value]` pairs.
    pub fn request(&self) -> String {
        self.call.request()
    }

    /// Decodes the answer to [`ApiCall::request`]: the HTTP status, the response headers as a JSON
    /// array of `[name, value]` pairs (only `Retry-After` and `X-Block-Height` are read), and the
    /// body. Returns the answer in JSON; a refusal is an error with the client's code
    /// (`RateLimited`, `NotFound`, `Refused`, `BadResponse`).
    pub fn decode(&self, status: u16, headers: &str, body: &[u8]) -> Result<String> {
        self.call.decode(status, headers, body)
    }
}

/// A submission split into requests within the pool's limits.
///
/// Transactions are added one by one, then [`SubmitPlanHandle::plan`] splits them; each answer
/// decoded by [`SubmitPlanHandle::decode`] is kept, and [`SubmitPlanHandle::finish`] joins them
/// with the refusals in submission order.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct SubmitPlanHandle {
    submission: Submission,
}

#[wasm_bindgen]
impl SubmitPlanHandle {
    /// A submission to a pool that takes at most `max_transactions_per_request` transactions per
    /// request and refuses a transaction above `max_transaction_bytes` (the node configuration's
    /// `pool.maxTransactionsPerRequest` and `pool.maxTransactionBytes`).
    #[wasm_bindgen(constructor)]
    pub fn new(max_transactions_per_request: u32, max_transaction_bytes: u32) -> SubmitPlanHandle {
        SubmitPlanHandle {
            submission: Submission::new(max_transactions_per_request, max_transaction_bytes),
        }
    }

    /// Adds a signed transaction, before [`SubmitPlanHandle::plan`].
    pub fn add(&mut self, signed: &SignedHandle) -> Result<()> {
        self.submission.add(signed.signed())
    }

    /// Splits the transactions into requests and returns how many to send. A transaction larger
    /// than the pool's size limit is refused here, with reason `too-large`, and never sent.
    pub fn plan(&mut self) -> Result<u32> {
        self.submission.plan()
    }

    /// Request number `index`, as [`ApiCall::request`] writes it.
    pub fn request(&self, index: u32) -> Result<String> {
        self.submission.request(index)
    }

    /// Decodes and keeps the answer to request number `index`, and returns its report in JSON:
    /// `{ outcomes: [{ id, status: "accepted", broadcast } | { id, status: "rejected", reason,
    /// nodeCode, message }] }`.
    pub fn decode(
        &mut self,
        index: u32,
        status: u16,
        headers: &str,
        body: &[u8],
    ) -> Result<String> {
        self.submission.decode(index, status, headers, body)
    }

    /// The transactions refused before sending, as a submission report in JSON.
    pub fn refused(&self) -> Result<String> {
        self.submission.refused()
    }

    /// Every outcome so far in submission order, in JSON: the refusals and the decoded answers. A
    /// transaction whose request was not decoded has no outcome.
    pub fn finish(&self) -> Result<String> {
        self.submission.finish()
    }
}

/// The node's request allowance, spent before each request (the reference implementation allows
/// 100 requests per 60 seconds per client address by default).
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct RequestBudgetHandle {
    budget: Budget,
}

#[wasm_bindgen]
impl RequestBudgetHandle {
    /// A budget of `requests` per `window_ms` milliseconds.
    #[wasm_bindgen(constructor)]
    pub fn new(requests: u32, window_ms: f64) -> RequestBudgetHandle {
        RequestBudgetHandle {
            budget: Budget::new(requests, window_ms),
        }
    }

    /// Takes one request at `now_ms` (any monotonic clock): 0 when granted, else the milliseconds
    /// to wait before asking again.
    pub fn acquire(&mut self, now_ms: f64) -> f64 {
        self.budget.acquire(now_ms)
    }

    /// Records that the node asked to wait `wait_ms` milliseconds at `now_ms`.
    #[wasm_bindgen(js_name = blockFor)]
    pub fn block_for(&mut self, now_ms: f64, wait_ms: f64) {
        self.budget.block_for(now_ms, wait_ms);
    }
}

/// The wait in milliseconds before retry number `attempt` (from 0) after HTTP 429, or `undefined`
/// when the retries are spent: 2 s doubling up to 30 s, three retries, or the node's own
/// `Retry-After` when that is longer.
#[wasm_bindgen(js_name = backoffDelay)]
pub fn backoff_delay(attempt: u32, retry_after_ms: Option<f64>) -> Option<f64> {
    api::backoff_delay(attempt, retry_after_ms)
}

/// `url` as a relay URL: `http` or `https`, a host, no credentials, query string or fragment;
/// trailing slashes removed.
#[wasm_bindgen(js_name = checkRelay)]
pub fn check_relay(url: &str) -> Result<String> {
    api::check_relay(url)
}
