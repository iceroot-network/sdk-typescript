//! Network profiles: the wrapper's plain profile objects, read into the core's profiles.

use iceroot_sdk::Profile;
use iceroot_sdk_bindings::profile;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::Result;

/// A network profile of the core. The wrapper keeps one per profile object it is given.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct ProfileHandle {
    profile: Profile,
}

#[wasm_bindgen]
impl ProfileHandle {
    /// The profile described by `json`, the wrapper's profile object:
    /// `{ id, backend, api: { relays, indexer? }, chain: { networkByte?, nethash?, chainId?,
    /// genesisHash? }, keyScheme }`.
    ///
    /// A `solar-compat` profile with the `bip32-secp256k1` scheme is a devnet in today's formats
    /// (network byte 90 unless given); the other combinations are the declared later stages,
    /// whose capabilities are all off in this release.
    #[wasm_bindgen(js_name = fromJson)]
    pub fn from_json(json: &str) -> Result<ProfileHandle> {
        profile::from_json(json).map(|profile| ProfileHandle { profile })
    }

    /// The profile as the wrapper's profile object, in JSON.
    #[wasm_bindgen(js_name = toJson)]
    pub fn to_json(&self) -> String {
        profile::to_json(&self.profile)
    }

    /// The profile id.
    pub fn id(&self) -> String {
        self.profile.id().to_owned()
    }

    /// The capabilities of the profile, by name.
    pub fn capabilities(&self) -> Vec<String> {
        profile::capabilities(&self.profile)
    }

    /// Whether the profile has the capability `name`.
    pub fn has(&self, name: &str) -> bool {
        profile::has(&self.profile, name)
    }

    /// The network name message signatures carry, for example `heartwood-devnet-v90`.
    #[wasm_bindgen(js_name = messageNetwork)]
    pub fn message_network(&self) -> Result<String> {
        profile::message_network(&self.profile)
    }

    /// The algorithm name of message signatures, for example `secp256k1-bip340-sha256`.
    #[wasm_bindgen(js_name = messageAlgorithm)]
    pub fn message_algorithm(&self) -> Result<String> {
        profile::message_algorithm(&self.profile)
    }
}

impl ProfileHandle {
    /// The core's profile.
    pub(crate) fn profile(&self) -> &Profile {
        &self.profile
    }

    /// A handle of `profile`.
    pub(crate) fn of(profile: Profile) -> ProfileHandle {
        ProfileHandle { profile }
    }
}
