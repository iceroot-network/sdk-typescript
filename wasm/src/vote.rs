//! The vote selection library: the four vote modes, the network's vote rules, and the check of an
//! earlier selection against newer data.
//!
//! Every function is a pure function of its arguments, as in the library itself. Values cross the
//! boundary as JSON in the shape of the TypeScript API, read and written by the shared bindings'
//! `vote` module: camelCase fields, and the 64- and 128-bit integers a JavaScript number cannot
//! hold (heights, vote weights, payouts, draw weights) as decimal strings. The library's refusals
//! keep their stable codes and details.

use iceroot_sdk_bindings::vote;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::chain::ChainHandle;
use crate::error::Result;

/// The vote library's JSON functions, as one export: `operation` names the function (`select`,
/// `evaluate`, `check`, `validate`, `split`, `voter`, `validateSnapshot`), which takes `first`,
/// `second` and `third` as the shared bindings' `vote_call` documents them (unused arguments are
/// empty).
///
/// One export instead of seven keeps the WebAssembly module smaller, since each export carries
/// its own conversion of arguments, results and errors.
#[wasm_bindgen(js_name = voteCall)]
pub fn vote_call(operation: &str, first: &str, second: &str, third: &str) -> Result<String> {
    vote::vote_call(operation, first, second, third)
}

/// The vote rules in force at `height` of `chain`, as a vote rules object in JSON: the limits of
/// the milestone, and the name rule and whether validators may vote of the format stage.
#[wasm_bindgen(js_name = voteRulesAt)]
pub fn vote_rules_at(chain: &ChainHandle, height: u32) -> String {
    vote::vote_rules_at(chain.chain(), height)
}

/// A snapshot of a node's validator list, marked `relay-approximate`, as the shared bindings'
/// `vote_snapshot_from_validators` documents it: `validators` is every registered validator as the
/// node API client decodes them, read at `height` of `chain`, and `lookups` maps a validator's
/// name to `{ registeredHeight?, firstForgedHeight? }`. A validator a vote may not name now is
/// left out.
#[wasm_bindgen(js_name = voteSnapshotFromValidators)]
pub fn vote_snapshot_from_validators(
    chain: &ChainHandle,
    height: u32,
    validators: &str,
    lookups: &str,
) -> Result<String> {
    vote::vote_snapshot_from_validators(chain.chain(), height, validators, lookups)
}

/// Test seams of the bindings only (feature `fixed-aux`, which the test build of the package turns
/// on and the published build never does): the library's constants, which the wrapper's are tested
/// against, and snapshots of relay data in the library's own relay form, for its devnet-shaped
/// fixture.
#[cfg(feature = "fixed-aux")]
mod testing {
    use super::*;

    /// The library's constants, in JSON: `{ modes, modeNames, libraryVersion, minPicks, maxPicks,
    /// defaultPicks, iceroot, solarCompatible }`.
    #[wasm_bindgen(js_name = voteLibrary)]
    pub fn vote_library() -> String {
        vote::testing::vote_library()
    }

    /// A snapshot of relay data in the vote library's relay form, marked `relay-approximate`.
    #[wasm_bindgen(js_name = voteSnapshotFromRelay)]
    pub fn vote_snapshot_from_relay(relay: &str) -> Result<String> {
        vote::testing::vote_snapshot_from_relay(relay)
    }
}
