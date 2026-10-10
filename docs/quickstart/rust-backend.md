# Quickstart: Rust backend (Axum)

Rust backends can use the Rust SDK natively: no WebAssembly, the same types and rules as the TypeScript package. The Rust node API client is sans-IO: `SolarCompat` builds each call (the request and the decoder of its answer) and `HttpClient`, behind the `http` feature, sends it. The TypeScript `connect` wraps these steps; in Rust, a short `connect` function of your own does the same (section 2). This page builds an Axum service with a validator list and a sign-in check. The crate's own documentation (rustdoc) in [sdk-rust](https://github.com/iceroot-network/sdk-rust) is the reference for exact signatures.

Requirements: Rust 1.98 or later, HTTPS access to the public `heartwood-core` repository (see [Installation](../installation.md#rust)), and a devnet (see [Devnet](../devnet.md)).

## 1. Dependencies

<!-- sample: pending; needs: rust-release-tag -->
```toml
# Cargo.toml
[package]
name = "iceroot-backend-quickstart"
version = "0.1.0"
edition = "2024"
rust-version = "1.98"

[dependencies]
iceroot-sdk = { git = "https://github.com/iceroot-network/sdk-rust.git", tag = "v0.1.0", features = ["http"] }
axum = "0.8"
serde_json = "1"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

<!-- sample: plain -->
```toml
# .cargo/config.toml
[net]
git-fetch-with-cli = true
```

## 2. Connect once, share the network

<!-- sample: verified 0.1.0 -->
```rust
// src/main.rs
use std::sync::Arc;

use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use iceroot_sdk::api::{HttpClient, PageRequest, Relay, SolarCompat};
use iceroot_sdk::profile::DevnetOptions;
use iceroot_sdk::{Chain, Error, Profile};
use serde_json::{Value, json};

/// A connected network: the HTTP client, the node API calls for the chain, and the chain itself.
pub struct Network {
    pub client: HttpClient,
    pub api: SolarCompat,
    pub chain: Chain,
}

/// Reads the node's configuration and the chain it serves, loads the chain for `profile` and checks
/// the node against it. A devnet profile without a network hash is pinned now (store
/// `chain.profile().chain().nethash`); a node of another chain is refused with `NetworkMismatch`.
/// The client checks each relay's chain before its first use, so a failover never switches chain.
pub async fn connect(profile: &Profile) -> Result<Network, Error> {
    let relays = profile.endpoints().relays.iter().map(|relay| Relay::parse(relay)).collect::<Result<Vec<_>, _>>()?;
    // A pinned profile names its chain, and every relay must serve it; one that is not pinned yet
    // takes the chain of the first relay that answers, and holds every other relay to it.
    let client = match profile.relay_identity() {
        Some(identity) => HttpClient::for_chain(relays, identity)?,
        None => HttpClient::new(relays)?,
    };
    let configuration = client.send(&SolarCompat::new(0).node_configuration()).await?;
    let api = SolarCompat::for_configuration(&configuration);
    let chain = Chain::from_node(profile, &client.send(&api.crypto_configuration()).await?)?;
    chain.check_node(&configuration)?;
    Ok(Network { client, api, chain })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let relay = std::env::var("ICEROOT_RELAY").unwrap_or_else(|_| "http://127.0.0.1:6003/api".into());
    let nethash = std::env::var("ICEROOT_NETHASH").ok();   // pin the devnet in deployment settings
    let net = Arc::new(connect(&Profile::devnet(DevnetOptions { relays: vec![relay], nethash })).await?);
    println!("Connected to {}", net.chain.nethash());

    let app = Router::new().route("/api/v1/validators", get(validators)).with_state(net);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3190").await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn validators(State(net): State<Arc<Network>>) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    match net.client.send(&net.api.validators(PageRequest::first(100))).await {
        Ok(page) => Ok(Json(json!({
            "data": page.items.iter().map(|v| json!({
                "rank": v.rank,                            // null when not ranked
                "name": v.name,
                "address": v.address,
                "status": v.status.as_str(),               // "active", "standby", "resigned-temporary" or "resigned-permanent"
                "voteWeight": v.vote_weight.to_string(),   // base units as a decimal string
                "voters": v.voters.to_string(),
            })).collect::<Vec<_>>(),
        }))),
        // Never answer with an empty list or sample data when the node is unavailable.
        Err(error) => Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({
            "error": { "code": error.code(), "message": "The network is unavailable. Please try again." }
        })))),
    }
}
```

Each `client.send` is one request, and the client keeps to the node's allowance of requests. As the TypeScript `connect`, the Tauri plugin and the Go SDK do, a Rust `HttpClient` of more than one relay checks every relay's chain before its first use and never asks a relay of another chain: against the chain it is given (`HttpClient::for_chain`, with the identity a pinned profile names), or else against the chain of the first relay it checks, for its lifetime. A client of one relay built without the chain's identity checks nothing. A call that can refuse its arguments (an account's address, a transaction id) returns a `Result` before anything is sent: `net.client.send(&net.api.account(&address)?)`.

## 3. Check a sign-in signature

Sign-in needs no node: the challenge format, the address of a public key and the signature check are pure functions of the profile.

<!-- sample: verified 0.1.0 -->
```rust
// src/signin.rs
use iceroot_sdk::message::{self, MessageSignature};
use iceroot_sdk::signin::{self, SignInRequest};
use iceroot_sdk::{Address, Error, Profile, PublicKey};

/// The address of a public key and the sign-in message for it, as the wallet will check it.
/// `issued_at` and `expires_at` are seconds since 1970-01-01T00:00:00Z, at most 300 apart.
pub fn challenge(profile: &Profile, origin: &str, public_key: &str, nonce: &str, issued_at: i64, expires_at: i64)
    -> Result<(String, String), Error>
{
    let key = PublicKey::from_hex(public_key).map_err(|_| Error::InvalidKey)?;   // refuses a key that is not a valid point
    let address = Address::from_public_key(&key, profile)?;
    let message = signin::build(profile, &SignInRequest { origin, public_key: &key, nonce, issued_at, expires_at })?;
    Ok((address.to_string(), message))
}

/// True only for a valid signature by this key over exactly this message, on this network.
pub fn verify(profile: &Profile, message: &str, public_key: &str, signature: &str) -> bool {
    let Ok(network) = profile.message_network() else { return false };   // "heartwood-devnet-v90" today
    message::verify(message, &MessageSignature {
        public_key: public_key.to_owned(),
        signature: signature.to_owned(),
        algorithm: message::ALGORITHM.to_owned(),
        network,
    })
}
```

## 4. Build and run

<!-- sample: plain -->
```sh
cargo run --locked
curl -fsS http://127.0.0.1:3190/api/v1/validators | head -c 400; echo
```

The response lists the devnet's validators in rank order.

## 5. Docker

The image build fetches public dependencies over HTTPS without credentials:

<!-- sample: plain -->
```dockerfile
# syntax=docker/dockerfile:1
FROM rust:1.98 AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry cargo build --release --locked
```

<!-- sample: plain -->
```sh
docker build -t iceroot-backend .
```

Pin the base image by digest in production. The build fetches `heartwood-core` from the public `https://github.com/iceroot-network/heartwood-core.git` repository without credentials.
