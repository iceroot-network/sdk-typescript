//! A network's loaded configuration: the chain a profile is bound to, its rules and economics.

use iceroot_sdk::Chain;
use iceroot_sdk_bindings::chain;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::Result;
use crate::profile::ProfileHandle;

/// A chain of the core: a network description and milestones loaded with `heartwood-crypto` and
/// checked against a profile.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct ChainHandle {
    chain: Chain,
}

#[wasm_bindgen]
impl ChainHandle {
    /// The chain of the crypto configuration a node reports (the `data` object of
    /// `/node/configuration/crypto`: `network`, `milestones` and optionally `genesisBlock`), for
    /// `profile`. The network byte must be the profile's, and so must the network hash when the
    /// profile has one pinned; otherwise the chain pins it ([`ChainHandle::profile`]).
    pub fn load(profile: &ProfileHandle, configuration: &str) -> Result<ChainHandle> {
        chain::load(profile.profile(), configuration).map(|chain| ChainHandle { chain })
    }

    /// The chain a node serves, for `profile`, from the node's answer to the `cryptoConfiguration`
    /// call of [`crate::api::ApiCall`]: its HTTP status, headers (as [`crate::api::ApiCall::decode`]
    /// takes them) and body. The network and milestones are loaded and checked as
    /// [`ChainHandle::load`] does, and the genesis block's payload hash must be the network hash.
    #[wasm_bindgen(js_name = fromNode)]
    pub fn from_node(
        profile: &ProfileHandle,
        status: u16,
        headers: &str,
        body: &[u8],
    ) -> Result<ChainHandle> {
        chain::from_node(profile.profile(), status, headers, body)
            .map(|chain| ChainHandle { chain })
    }

    /// Decodes the node's answer to the `nodeConfiguration` call of [`crate::api::ApiCall`] and
    /// refuses a node of another chain than this one: another network hash or address network
    /// byte gives `NetworkMismatch`. Returns the configuration in JSON, as
    /// [`crate::api::ApiCall::decode`] does.
    #[wasm_bindgen(js_name = checkNode)]
    pub fn check_node(&self, status: u16, headers: &str, body: &[u8]) -> Result<String> {
        chain::check_node(&self.chain, status, headers, body)
    }

    /// The profile, with the network hash pinned.
    pub fn profile(&self) -> ProfileHandle {
        ProfileHandle::of(self.chain.profile().clone())
    }

    /// The network hash (64 lowercase hex digits).
    pub fn nethash(&self) -> String {
        self.chain.nethash().to_owned()
    }

    /// The address network byte.
    #[wasm_bindgen(js_name = networkByte)]
    pub fn network_byte(&self) -> u8 {
        self.chain.network_byte()
    }

    /// The network's own asset. JSON: `{ assetId, name, symbol, decimals }`.
    pub fn token(&self) -> String {
        chain::token(&self.chain)
    }

    /// The format stage at `height`: `s1`, `pq` or `id`.
    #[wasm_bindgen(js_name = stageAt)]
    pub fn stage_at(&self, height: u32) -> String {
        chain::stage_at(&self.chain, height)
    }

    /// The rules in force at `height`, in JSON.
    pub fn rules(&self, height: u32) -> String {
        chain::rules(&self.chain, height)
    }

    /// The economics in force at `height`, in JSON.
    pub fn economics(&self, height: u32) -> String {
        chain::economics(&self.chain, height)
    }

    /// The most validator seats a milestone of the chain names (its `activeDelegates`). The
    /// economics list a reward per seat, so the wrapper refuses a chain with implausibly many.
    #[wasm_bindgen(js_name = mostSeats)]
    pub fn most_seats(&self) -> u64 {
        self.chain
            .milestones()
            .all()
            .iter()
            .map(|params| params.active_delegates())
            .max()
            .unwrap_or(0)
    }
}

impl ChainHandle {
    /// The core's chain.
    pub(crate) fn chain(&self) -> &Chain {
        &self.chain
    }

    /// A handle of `chain`.
    pub(crate) fn of(chain: Chain) -> ChainHandle {
        ChainHandle { chain }
    }
}
