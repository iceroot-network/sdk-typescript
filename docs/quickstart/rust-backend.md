# Quickstart: Rust backend (Axum)

The explorer and the validators portal have Rust (Axum) backends. They use the Rust SDK natively: no WebAssembly, the same API in snake case. This page builds an Axum service with two endpoints, the validator list and a sign-in signature check. The crate's own documentation (rustdoc) in [sdk-rust](https://github.com/iceroot-network/sdk-rust) is the reference for exact signatures.

Requirements: Rust 1.98 or later, read access to `heartwood-core` over SSH until it is public (see [Installation](../installation.md#rust)), and a devnet (see [Devnet](../devnet.md)).

## 1. Dependencies

<!-- sample: pending; needs: rust:iceroot-sdk-crate, rust:http-feature -->
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

<!-- sample: pending; needs: rust:Profile::devnet, rust:connect, rust:Network, rust:validators().list, rust:Error -->
```rust
// src/main.rs
use std::sync::Arc;

use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use iceroot_sdk::{connect, DevnetOptions, Network, Profile};
use serde_json::{json, Value};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let relay = std::env::var("ICEROOT_RELAY").unwrap_or_else(|_| "http://127.0.0.1:6003/api".into());
    let nethash = std::env::var("ICEROOT_NETHASH").ok();   // pin the devnet in deployment settings
    let profile = Profile::devnet(DevnetOptions { relays: vec![relay], nethash, ..Default::default() });
    let net = Arc::new(connect(profile).await?);

    let app = Router::new().route("/api/v1/validators", get(validators)).with_state(net);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3190").await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn validators(State(net): State<Arc<Network>>) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    match net.validators().list().await {
        Ok(list) => Ok(Json(json!({
            "data": list.iter().map(|v| json!({
                "rank": v.rank,
                "name": v.name,
                "address": v.address.to_string(),
                "status": v.status,
                "voteWeight": v.vote_weight.to_string(),   // base units as a decimal string
                "voters": v.voters,
            })).collect::<Vec<_>>(),
        }))),
        // Never answer with an empty list or sample data when the node is unavailable.
        Err(error) => Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({
            "error": { "code": error.code(), "message": "The network is unavailable. Please try again." }
        })))),
    }
}
```

## 3. Check a sign-in signature

Sign-in needs no node: the challenge format, the address of a public key and the signature check are pure functions of the profile.

<!-- sample: pending; needs: rust:PublicKey::from_hex, rust:Address::from_public_key, rust:signin::SignIn::build, rust:messages::verify, rust:messages::network_of -->
```rust
use iceroot_sdk::{messages, signin::{self, SignIn}, Address, Profile, PublicKey};

/// The challenge text for a public key, as the wallet will check it.
pub fn challenge(profile: &Profile, origin: &str, public_key: &str, nonce: &str, issued_at: &str, expires_at: &str)
    -> Result<(String, String), iceroot_sdk::Error>
{
    let key = PublicKey::from_hex(public_key)?;                 // refuses a key that is not a valid point
    let address = Address::from_public_key(&key, profile)?;
    let message = SignIn::build(&signin::Fields {
        origin, network: &messages::network_of(profile), public_key, address: &address.to_string(), nonce, issued_at, expires_at,
    })?;
    Ok((address.to_string(), message))
}

/// True only for a valid signature by this key over exactly this message.
pub fn verify(profile: &Profile, message: &str, public_key: &str, signature: &str) -> bool {
    messages::verify(profile, message, public_key, signature).unwrap_or(false)
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

Until `heartwood-core` is public, the image build fetches it over SSH with BuildKit's SSH forwarding:

<!-- sample: plain -->
```dockerfile
# syntax=docker/dockerfile:1
FROM rust:1.98 AS build
WORKDIR /src
RUN mkdir -p -m 0700 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
COPY . .
RUN --mount=type=ssh --mount=type=cache,target=/usr/local/cargo/registry cargo build --release --locked
```

<!-- sample: plain -->
```sh
docker build --ssh default -t iceroot-backend .
```

Pin the base image by digest in production, as the explorer's Dockerfile already does. If sdk-rust fetches `heartwood-core` through an SSH host alias, add the same URL rewrite inside the build stage (`git config --global url."ssh://git@github.com/".insteadOf ...`, see [Installation](../installation.md#rust)).
