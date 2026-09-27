//! A network's loaded configuration: the chain a profile is bound to, its rules and economics.

use iceroot_sdk::Chain;
use iceroot_sdk::rules::Rules;
use serde_json::{Map, Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::error::Result;
use crate::json::amount_value;
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
        Ok(ChainHandle {
            chain: Chain::load(profile.profile(), configuration)?,
        })
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
        let token = self.chain.token();
        json!({
            "assetId": token.asset.to_string(),
            "name": token.name,
            "symbol": token.symbol,
            "decimals": token.decimals,
        })
        .to_string()
    }

    /// The format stage at `height`: `s1`, `pq` or `id`.
    #[wasm_bindgen(js_name = stageAt)]
    pub fn stage_at(&self, height: u32) -> String {
        self.chain.stage_at(height).as_str().to_owned()
    }

    /// The rules in force at `height`, in JSON.
    pub fn rules(&self, height: u32) -> String {
        rules_json(&self.chain.rules(height)).to_string()
    }

    /// The economics in force at `height`, in JSON.
    pub fn economics(&self, height: u32) -> String {
        let economics = self.chain.economics(height);
        json!({
            "height": economics.height(),
            "seats": economics.seats(),
            "blockTimeSeconds": economics.block_time_seconds(),
            "rewardsByRank": economics
                .rewards_by_rank()
                .into_iter()
                .map(|(rank, reward)| json!({ "rank": rank, "reward": reward.map(amount_value) }))
                .collect::<Vec<_>>(),
            "secondaryReward": economics.secondary_reward().map(amount_value),
            "donations": economics
                .donations()
                .into_iter()
                .map(|donation| json!({
                    "address": donation.address.to_string(),
                    "basisPoints": donation.basis_points,
                    "purpose": donation.purpose,
                }))
                .collect::<Vec<_>>(),
            "feeBurnBasisPoints": economics.fee_burn_basis_points(),
            "minBurn": amount_value(economics.min_burn()),
        })
        .to_string()
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

fn rules_json(rules: &Rules) -> Value {
    let dynamic = rules.fees.dynamic.as_ref().map(|dynamic| {
        let addon_bytes: Map<String, Value> = dynamic
            .addon_bytes
            .iter()
            .map(|(kind, bytes)| (kind.as_str().to_owned(), json!(bytes)))
            .collect();
        json!({
            "enabled": dynamic.enabled,
            "minFee": dynamic.min_fee,
            "addonBytes": addon_bytes,
        })
    });
    json!({
        "height": rules.height,
        "stage": rules.stage.as_str(),
        "transfer": {
            "minRecipients": rules.transfer.min_recipients,
            "maxRecipients": rules.transfer.max_recipients,
            "minAmount": amount_value(rules.transfer.min_amount),
        },
        "memo": { "maxBytes": rules.memo.max_bytes },
        "vote": {
            "minEntries": rules.vote.min_entries,
            "maxEntries": rules.vote.max_entries,
            "totalBasisPoints": rules.vote.total_basis_points,
            "maxBasisPointsPerEntry": rules.vote.max_basis_points_per_entry,
            "maxBytes": rules.vote.max_bytes,
        },
        "name": {
            "minLength": rules.name.min_length,
            "maxLength": rules.name.max_length,
            "characters": rules.name.characters,
        },
        "burn": { "minAmount": amount_value(rules.burn.min_amount) },
        "fees": {
            "dynamic": dynamic,
            "floorAvailable": rules.fees.floor_available,
        },
        "resignation": {
            "blocksBeforeRevoke": rules.resignation.blocks_before_revoke,
        },
        "maxTransactionBytes": rules.max_transaction_bytes,
        "maxAmount": amount_value(rules.max_amount),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) const CONFIGURATION: &str = include_str!("../examples/devnet-configuration.json");

    pub(crate) fn devnet() -> ChainHandle {
        let profile = ProfileHandle::from_json(
            r#"{"id":"devnet","backend":"solar-compat","api":{"relays":["http://127.0.0.1:4003/api"]},"chain":{"networkByte":90},"keyScheme":"bip32-secp256k1"}"#,
        )
        .unwrap();
        ChainHandle::load(&profile, CONFIGURATION).unwrap()
    }

    #[test]
    fn load_and_describe() {
        let chain = devnet();
        assert_eq!(chain.network_byte(), 90);
        assert_eq!(chain.nethash().len(), 64);
        let pinned: Value = serde_json::from_str(&chain.profile().to_json()).unwrap();
        assert_eq!(pinned["chain"]["nethash"], chain.nethash());
        let token: Value = serde_json::from_str(&chain.token()).unwrap();
        assert_eq!(token["decimals"], 8);
        assert_eq!(token["assetId"], "ROOT");
        let rules: Value = serde_json::from_str(&chain.rules(2)).unwrap();
        assert_eq!(rules["memo"]["maxBytes"], 255);
        assert_eq!(rules["transfer"]["maxRecipients"], 256);
        let economics: Value = serde_json::from_str(&chain.economics(2)).unwrap();
        assert_eq!(economics["seats"], 53);
        assert_eq!(chain.stage_at(2), "s1");

        let other = ProfileHandle::from_json(
            r#"{"id":"devnet","backend":"solar-compat","api":{"relays":[]},"chain":{"networkByte":30},"keyScheme":"bip32-secp256k1"}"#,
        )
        .unwrap();
        assert_eq!(
            ChainHandle::load(&other, CONFIGURATION).unwrap_err().code(),
            "NetworkMismatch"
        );
    }
}
