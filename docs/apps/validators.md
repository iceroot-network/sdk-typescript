# Integration guide: validators portal

The validators portal (`iceroot-network/validators`) is a Next.js frontend with a Rust (Axum and SQLite) API in `backend/`. Wiring touches three parts:

1. **Sign-in.** The backend's own secp256k1, RIPEMD-160 and Base58Check code is replaced by the Rust SDK, so the portal and the wallet share one implementation of the challenge format and the signature check.
2. **The directory.** Rank, status, vote weight, voters and block production come from the chain instead of the sample validators. Proposals, contributions and profile texts stay the portal's own data.
3. **The rewards calculator.** Its constants come from the network's economics.

The browser needs no SDK: the backend does the work, and the page keeps using the wallet's provider for sign-in. No Content Security Policy or Next.js configuration changes.

Read first: [Concepts](../concepts.md), [Rules](../rules.md), [Rust backend quickstart](../quickstart/rust-backend.md).

## What to wire now and what waits

| Part | Release 0.1.0 | Waits for |
|---|---|---|
| Sign-in challenge and verification through the SDK | Wire now | |
| Directory figures from the chain; linking a signed identity to its on-chain validator by address | Wire now | |
| Rewards calculator inputs from `net.economics` | Wire now | |
| Per-validator vote cap and the vote-weight threshold in the calculator | Show as rules of the IceRoot networks, not of the devnet | The IceRoot genesis (the economics then include them) |
| Declared reward-sharing terms read from the chain | Keep the portal's self-declared fields, labelled as such | Capability `share-declare` |
| Post-quantum sign-in (ML-DSA-65, `ice1...` addresses) | No | The post-quantum formats and the IceRoot genesis |

## The current sample-data layer

| File | Role today |
|---|---|
| `backend/src/lib.rs` | `NETWORK = "heartwood-devnet-v90"`; `identity(public_key)` derives the address (Base58Check of byte 90 and RIPEMD-160); `verify_signature` checks BIP340 over SHA-256; `challenge` formats the 12-line message; `verify` checks it; `validators` and `validator_detail` list published profiles |
| `backend/src/seed.rs` | Eight sample validators flagged `isSample`, with sample `RANKS`, `VOTE_WEIGHTS`, voters and uptime |
| `backend/Cargo.toml` | `secp256k1 = 0.31`, `ripemd`, `bs58`, `sha2`, `hex` for the sign-in code |
| `components/auth.tsx` | `window.iceroot.request({ method: "connect" })` and `signMessage`, or a pasted signature; checks `network === "heartwood-devnet-v90"` and `algorithm === "secp256k1-bip340-sha256"` |
| `lib/types.ts` | `Validator` (with `rank`, `votingWeight`, `voters`, `uptime`, `status`, `isSample`), `Challenge`, `WalletIdentity`, `WalletSignature` |
| `lib/rewards.ts` | `REWARD_RULES` (53 seats, 8 s blocks, 10 % donations, 100,000,000 supply, 5 % caps), `rewardForRank`, `calculateRewards` |
| `docs/CONTRACT.md` | The sign-in contract and the exact challenge format |

## Sign-in

### Mapping

| Portal code | SDK |
|---|---|
| `identity(public_key)` | `PublicKey::from_hex` and `Address::from_public_key(&key, &profile)` |
| `verify_signature(public_key, message, signature)` | `messages::verify(&profile, message, public_key, signature)` |
| The `format!` of the challenge in `challenge` | `SignIn::build(...)`, which produces the same 12 lines |
| `NETWORK` | `messages::network_of(&profile)`; `heartwood-devnet-v90` on today's devnet |
| The algorithm string in `components/auth.tsx` | The value the backend returns with the challenge |

The challenge format does not change: version 1, the same 12 lines, the same checks. The wallet runs `SignIn.parse` from the same SDK before it signs, so the two sides cannot disagree.

### Steps

1. Add `iceroot-sdk` (see [Installation](../installation.md#rust)); the portal needs no `http` feature for sign-in alone, but the directory below does.
2. Replace `identity` and `verify_signature` with the SDK calls, and build the message with `SignIn::build`:

<!-- sample: pending; needs: rust:PublicKey::from_hex, rust:Address::from_public_key, rust:signin::SignIn::build, rust:messages::verify, rust:messages::network_of -->
```rust
use iceroot_sdk::{messages, signin::{self, SignIn}, Address, PublicKey};

pub fn identity(profile: &iceroot_sdk::Profile, public_key: &str) -> Result<(String, String), String> {
    let key = PublicKey::from_hex(public_key).map_err(|e| e.to_string())?;   // refuses an invalid point
    let address = Address::from_public_key(&key, profile).map_err(|e| e.to_string())?;
    Ok((key.to_hex(), address.to_string()))
}

pub fn verify_signature(profile: &iceroot_sdk::Profile, public_key: &str, message: &str, signature: &str) -> bool {
    messages::verify(profile, message, public_key, signature).unwrap_or(false)
}

fn challenge_message(profile: &iceroot_sdk::Profile, origin: &str, public_key: &str, address: &str,
                     nonce: &str, issued: &str, expires: &str) -> Result<String, iceroot_sdk::Error> {
    SignIn::build(&signin::Fields {
        origin, network: &messages::network_of(profile), public_key, address, nonce, issued_at: issued, expires_at: expires,
    })
}
```

3. Remove `secp256k1`, `ripemd` and `bs58` from `backend/Cargo.toml`. Keep `sha2` and `hex` if the token hashing still uses them.
4. Keep everything around the check: the browser-binding cookie, the stored exact message, single atomic consumption, the five-minute expiry, the rate limits and the CSRF token.
5. Return `network` and `algorithm` with the challenge (the response already has `network`), and make `components/auth.tsx` compare the wallet's answer with those values instead of the hard-coded strings.
6. Run the existing sign-in tests, including the browser integration test with the browser wallet: both sides now run the SDK.

## The directory

### Mapping

| Portal field | Source after wiring | Notes |
|---|---|---|
| `rank`, `status` | `validators().list()`: `rank`, `status` | Map `resigned-temporary` and `resigned-permanent` to the portal's own wording; `candidate` stays for profiles with no on-chain validator |
| `votingWeight` | `vote_weight` (base units) | Format with `Amount::format` and the token's decimals (8 today); keep it a string in JSON |
| `voters` | `voters` | |
| `uptime` | From `production`: forged and missed block counts | Today these are lifetime counters, not a 30-day window; label them so |
| `address`, `publicKey` | The chain's validator address; the signed-in key | |
| `name` (validator name) | The chain's validator name | The display name, tagline, location, website and proposal stay the portal's data |
| `sharingPercent`, `payoutSchedule`, `minimumPayout` | The portal's data, labelled as self-declared | From the IceRoot genesis, declared terms come from the chain (capability `share-declare`) |
| `isSample` | Remove the sample validators when the chain is connected | Sample records never mix with chain records |

### Steps

1. Connect the backend to the devnet (the [Rust backend quickstart](../quickstart/rust-backend.md) shows the setup) and cache `validators().list()`, refreshed once per round (53 blocks of 8 seconds). One request per round keeps well inside the API's rate limit.
2. Link a signed identity to its validator: when a signed-in account's address equals the address of a registered validator, the portal shows that profile with the chain's rank and status. Status and rank are never taken from the profile or set by the holder.
3. Drop `seed.rs`'s sample validators from the directory once the chain is connected; keep them only in a clearly separate demo mode, if at all.
4. When the network is unavailable, show the portal's own data with the chain figures marked unavailable. Never show old chain figures as current, and never fill them with sample numbers.

## The rewards calculator

`lib/rewards.ts` hard-codes the network's economics. Read them from the network instead. The page does not need WebAssembly for this: add a backend endpoint that returns the economics as JSON, and load it on the calculator page.

<!-- sample: pending; needs: rust:economics, rust:economics().supply -->
```rust
// GET /api/v1/network: the figures the calculator needs, amounts as decimal strings of base units
async fn network(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let economics = state.net.economics();
    let supply = state.net.economics().supply().await.map_err(|_| ApiError::unavailable())?;
    Ok(Json(json!({
        "network": state.net.profile().id(),
        "decimals": state.net.token().decimals,
        "seats": economics.seats,
        "blockTimeSeconds": economics.block_time_seconds,
        "rewardsByRank": economics.rewards_by_rank.iter().map(|r| r.to_string()).collect::<Vec<_>>(),
        "donations": economics.donations.iter().map(|d| json!({ "address": d.address.to_string(), "basisPoints": d.basis_points })).collect::<Vec<_>>(),
        "supply": supply.current.to_string(),
        "maxShareBasisPoints": state.net.rules().vote.max_share_basis_points,       // null on today's devnet
        "voteWeightThresholdBasisPoints": economics.vote_weight_threshold_basis_points, // null on today's devnet
    })))
}
```

| `REWARD_RULES` field | Source |
|---|---|
| `validators` | `seats` |
| `blockSeconds`, `roundSeconds` | `blockTimeSeconds`; a round is `seats` blocks |
| `donationPercent` | The sum of `donations[].basisPoints` |
| `supply` | `supply` (the current supply, not the genesis figure) |
| `maxVotePercent` | `maxShareBasisPoints` when set |
| `weightlessAbovePercent` | `voteWeightThresholdBasisPoints` when set |
| `rewardForRank` tiers | `rewardsByRank` |

- The calculator's estimates may stay floating-point arithmetic, because they are estimates that nothing signs. Convert the base-unit strings with the token's decimals once, at the input, and label results as estimates, as the page does now.
- Where a figure is `null` on today's devnet (the per-validator cap and the vote-weight threshold start at the IceRoot genesis), keep the rule in the calculator only if the page says it applies from the IceRoot genesis, or hide the control.

## Rules that apply to the portal

- Sign only through the wallet's provider or a pasted signature; the portal never receives a phrase or key ([rule 6](../rules.md) and the portal's own contract).
- Verify every signature on the server with the SDK; never trust a signature check in the page.
- Never take rank, status or vote weight from a profile; they come from the chain.
- Never show sample or stale chain figures as current ([rule 13](../rules.md)).
- Read the economics from the network ([rule 1](../rules.md)).

## Tests to add

- Sign-in: the existing tests plus a challenge built by `SignIn::build` and signed by the browser wallet through the SDK; a tampered message and a wrong key are refused.
- Directory: with the relay unreachable, chain figures show as unavailable and nothing falls back to samples.
- Calculator: the page reads the economics endpoint, and its figures match `net.economics` on a local devnet.
