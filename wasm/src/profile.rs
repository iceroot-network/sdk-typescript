//! Network profiles: the wrapper's plain profile objects, read into the core's profiles.

use iceroot_sdk::Profile;
use iceroot_sdk::message::ALGORITHM;
use iceroot_sdk::profile::{Capability, DevnetOptions, IdDevnetOptions};
use serde_json::{Map, Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::{BindingError, Result};
use crate::json;

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
        let object = json::parse_object(json, "the profile")?;
        read(&object).map(|profile| ProfileHandle { profile })
    }

    /// The profile as the wrapper's profile object, in JSON.
    #[wasm_bindgen(js_name = toJson)]
    pub fn to_json(&self) -> String {
        write(&self.profile).to_string()
    }

    /// The profile id.
    pub fn id(&self) -> String {
        self.profile.id().to_owned()
    }

    /// The capabilities of the profile, by name.
    pub fn capabilities(&self) -> Vec<String> {
        self.profile
            .capabilities()
            .iter()
            .map(|capability| capability.as_str().to_owned())
            .collect()
    }

    /// Whether the profile has the capability `name`.
    pub fn has(&self, name: &str) -> bool {
        Capability::parse(name)
            .is_some_and(|capability| self.profile.capabilities().has(capability))
    }

    /// The network name message signatures carry, for example `heartwood-devnet-v90`.
    #[wasm_bindgen(js_name = messageNetwork)]
    pub fn message_network(&self) -> Result<String> {
        Ok(self.profile.message_network()?)
    }

    /// The algorithm name of message signatures, for example `secp256k1-bip340-sha256`.
    #[wasm_bindgen(js_name = messageAlgorithm)]
    pub fn message_algorithm(&self) -> Result<String> {
        self.profile.require(Capability::MessageSigning)?;
        Ok(ALGORITHM.to_owned())
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

fn read(object: &Map<String, Value>) -> Result<Profile> {
    let id = json::string(object, "id")?;
    if id.is_empty() {
        return Err(BindingError::profile("a profile needs an id"));
    }
    let api = json::object(json::member(object, "api")?, "api")?;
    let relays = json::array(api, "relays")?
        .iter()
        .map(|relay| {
            relay
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| BindingError::profile("a relay URL is not a string"))
        })
        .collect::<Result<Vec<_>>>()?;
    let indexer = json::optional_string(api, "indexer")?.map(str::to_owned);
    let chain = json::object(json::member(object, "chain")?, "chain")?;
    let nethash = json::optional_string(chain, "nethash")?.map(str::to_owned);
    let network_byte = json::optional(chain, "networkByte")
        .map(|value| {
            value
                .as_u64()
                .and_then(|byte| u8::try_from(byte).ok())
                .ok_or_else(|| BindingError::profile("a network byte is an integer from 0 to 255"))
        })
        .transpose()?;
    let backend = json::string(object, "backend")?;
    let key_scheme = json::string(object, "keyScheme")?;
    let profile = match (backend, key_scheme) {
        ("solar-compat", "bip32-secp256k1") => {
            let mut profile = Profile::devnet(DevnetOptions {
                relays,
                nethash: None,
            });
            if let Some(byte) = network_byte {
                profile = profile.with_network_byte(byte);
            }
            match nethash {
                Some(nethash) => profile
                    .with_nethash(&nethash)
                    .map_err(|_| BindingError::profile("a network hash is 64 hex digits"))?,
                None => profile,
            }
        }
        ("solar-compat", "slip10-mldsa65") => Profile::devnet_pq(DevnetOptions { relays, nethash }),
        ("iceroot", "slip10-mldsa65") => Profile::id_devnet(IdDevnetOptions {
            relays,
            indexer,
            chain_id: json::optional_string(chain, "chainId")?.map(str::to_owned),
            genesis_hash: json::optional_string(chain, "genesisHash")?.map(str::to_owned),
        }),
        _ => {
            return Err(BindingError::profile(format!(
                "no profile has the backend {backend:?} with the key scheme {key_scheme:?}"
            )));
        }
    };
    Ok(profile.with_id(id))
}

fn write(profile: &Profile) -> Value {
    let chain = profile.chain();
    let mut identity = Map::new();
    if let Some(byte) = chain.network_byte {
        identity.insert("networkByte".into(), json!(byte));
    }
    if let Some(hrp) = chain.hrp {
        identity.insert("hrp".into(), json!(hrp.as_str()));
    }
    if let Some(nethash) = &chain.nethash {
        identity.insert("nethash".into(), json!(nethash));
    }
    if let Some(chain_id) = &chain.chain_id {
        identity.insert("chainId".into(), json!(chain_id));
    }
    if let Some(genesis_hash) = &chain.genesis_hash {
        identity.insert("genesisHash".into(), json!(genesis_hash));
    }
    let endpoints = profile.endpoints();
    let mut api = Map::new();
    api.insert("relays".into(), json!(endpoints.relays));
    if let Some(indexer) = &endpoints.indexer {
        api.insert("indexer".into(), json!(indexer));
    }
    json!({
        "id": profile.id(),
        "backend": profile.backend().as_str(),
        "api": api,
        "chain": identity,
        "keyScheme": profile.key_scheme().as_str(),
        "coinType": profile.coin_type(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NETHASH: &str = "c9b03ab996ef3ac216a2ac53eaee71118cbf7995fa44449a7fb7f94bbe18bcca";

    fn devnet(extra: &str) -> String {
        format!(
            r#"{{"id":"devnet","backend":"solar-compat","api":{{"relays":["http://127.0.0.1:4003/api"]}},"chain":{{{extra}}},"keyScheme":"bip32-secp256k1","coinType":1}}"#
        )
    }

    #[test]
    fn devnet_profiles_round_trip() {
        let handle = ProfileHandle::from_json(&devnet(r#""networkByte":90"#)).unwrap();
        assert_eq!(handle.profile().chain().network_byte, Some(90));
        assert!(handle.has("transfer"));
        assert!(!handle.has("finality"));
        assert!(!handle.has("no such capability"));
        assert_eq!(handle.message_network().unwrap(), "heartwood-devnet-v90");
        assert_eq!(handle.message_algorithm().unwrap(), ALGORITHM);
        let again = ProfileHandle::from_json(&handle.to_json()).unwrap();
        assert_eq!(again.profile(), handle.profile());

        let pinned = ProfileHandle::from_json(&devnet(&format!(
            r#""networkByte":30,"nethash":"{NETHASH}""#
        )))
        .unwrap();
        assert_eq!(pinned.profile().chain().network_byte, Some(30));
        assert_eq!(pinned.profile().chain().nethash.as_deref(), Some(NETHASH));
    }

    #[test]
    fn bad_profiles_are_refused() {
        for json in [
            "[]".to_owned(),
            devnet(r#""networkByte":256"#),
            devnet(r#""nethash":"abc""#),
            devnet("").replace("solar-compat", "other"),
            devnet("").replace(r#""id":"devnet""#, r#""id":"""#),
        ] {
            let error = ProfileHandle::from_json(&json).unwrap_err();
            assert!(
                ["InvalidProfile", "InvalidArgument"].contains(&error.code()),
                "{json}: {error:?}"
            );
        }
        let later =
            ProfileHandle::from_json(&devnet("").replace("bip32-secp256k1", "slip10-mldsa65"))
                .unwrap();
        assert!(later.capabilities().is_empty());
        assert_eq!(later.id(), "devnet");
        assert_eq!(
            later.message_network().unwrap_err().code(),
            "UnsupportedOnNetwork"
        );
    }
}
