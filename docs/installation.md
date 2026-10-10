# Installation

The first release will be on GitHub. No release is available yet. Each release will have a git tag (`v0.1.0`, `v0.2.0`, ...) with these assets attached:

| Asset | What it is |
|---|---|
| `iceroot-network-sdk-<version>.tgz` | The npm package, with the WebAssembly module already built |
| `iceroot_sdk_bg.wasm`, `iceroot-sdk-bytes.js` | The WebAssembly module, and the same module as an embedded byte array, on their own for hosts that serve them separately |
| `SHA256SUMS` | SHA-256 of each asset above |
| Release notes | The `heartwood-crypto` version the release contains, the profiles and backends it supports, and the changes |

Nothing is published to the npm registry or to crates.io yet. Installing needs no account, token or registry configuration, and no Rust toolchain: the tarball contains the compiled module.

## TypeScript and JavaScript

Requirements: Node.js 22 or later for tooling and Node use; TypeScript 5.7 or later (7.0 works) if you type check. The package has no runtime npm dependencies.

No release is available yet. Build from source as described in [Development](development.md#building-from-source). The following installation samples remain pending until the first release. Then install by its tarball URL:

<!-- sample: pending; needs: release-tarball -->
```sh
npm install https://github.com/iceroot-network/sdk-typescript/releases/download/v0.1.0/iceroot-network-sdk-0.1.0.tgz
```

npm records the dependency in `package.json` under the package's name, with the URL as its version:

<!-- sample: pending; needs: release-tarball -->
```json
{
  "dependencies": {
    "@iceroot-network/sdk": "https://github.com/iceroot-network/sdk-typescript/releases/download/v0.1.0/iceroot-network-sdk-0.1.0.tgz"
  }
}
```

Imports use the package name, exactly as they will after the package reaches the npm registry, so moving to the registry later changes only this one line:

<!-- sample: verified 0.1.0 -->
```ts
import { init, connect, profiles } from "@iceroot-network/sdk";
```

### Check what you installed

`package-lock.json` records an `integrity` hash for the tarball, and `npm ci` refuses a download that does not match it. Commit the lockfile. To check a release by hand against its published sums before you add it:

<!-- sample: pending; needs: release-tarball -->
```sh
curl -fsSLO https://github.com/iceroot-network/sdk-typescript/releases/download/v0.1.0/iceroot-network-sdk-0.1.0.tgz
curl -fsSLO https://github.com/iceroot-network/sdk-typescript/releases/download/v0.1.0/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

On macOS use `shasum -a 256 --check --ignore-missing SHA256SUMS`.

### Upgrade

Replace the version in both places of the URL and run `npm install` again. Read the release notes first: `0.x` releases may change the API, and the notes say how.

### Package entry points

| Import | Use it for |
|---|---|
| `@iceroot-network/sdk` | Everything. Node picks the Node build through the `node` export condition; browsers and bundlers get the web build |
| `@iceroot-network/sdk/vote` | The vote selection library: the four vote modes, `check`, `split` and `validateVote` ([Vote selection](vote.md)) |
| `@iceroot-network/sdk/keystore` | The keystore: a recovery phrase encrypted under a password ([Keystore](keystore.md)) |
| `@iceroot-network/sdk/ownership` | Ownership proofs of Solar addresses, for the Legacy Signer and the services that check its proofs ([Ownership proofs](ownership.md)) |
| `@iceroot-network/sdk/iife` | A classic script for pages without a bundler. It defines the global `IceRootSdk`, with the vote library, the keystore and the ownership proofs as its namespaces `vote`, `keystore` and `ownership` |
| `@iceroot-network/sdk/iife/bytes` | The WebAssembly module as an embedded byte array (global `IceRootSdkWasmBytes`), for contexts that cannot fetch a file: a Manifest V3 sandbox page or service worker |
| `@iceroot-network/sdk/wasm` | The `.wasm` file of the web build, for hosts that serve it from their own location and pass its URL to `init` |
| `@iceroot-network/sdk/tauri` | The same interface backed by the native Tauri plugin, `tauri-plugin-iceroot` of sdk-rust, for Tauri apps: keys, signing, the keystore and node requests in Rust; the calls that compute return promises. `@iceroot-network/sdk/tauri/vote`, `/tauri/keystore` and `/tauri/ownership` are its vote library, keystore and ownership proofs ([Tauri quickstart](quickstart/tauri.md)) |

Files in the tarball, for tools that copy them into an app (some wallets do):

<!-- sample: verified 0.1.0 -->
```text
package/dist/web/index.js              ES module for browsers and bundlers
package/dist/web/iceroot_sdk_bg.wasm   its WebAssembly module
package/dist/web/vote.js               the vote library's entry (keystore.js likewise); they share chunks/ with index.js
package/dist/node/index.js             Node build
package/dist/iife/iceroot-sdk.js       classic script (global IceRootSdk)
package/dist/iife/iceroot-sdk_bg.wasm  its WebAssembly module (the same module)
package/dist/iife/iceroot-sdk-bytes.js the same module as a byte array (global IceRootSdkWasmBytes)
package/dist/tauri/index.js            the Tauri entry (vote.js, keystore.js, ownership.js likewise): no WebAssembly
```

How each environment loads the module, and the settings it needs, is in its quickstart: [Node](quickstart/node.md), [Vite and React](quickstart/vite-react.md), [Next.js](quickstart/nextjs.md), [Manifest V3](quickstart/mv3-extension.md) and [Tauri](quickstart/tauri.md).

## Rust

Rust backends use the Rust SDK directly. It is a git dependency on a tag of [sdk-rust](https://github.com/iceroot-network/sdk-rust):

<!-- sample: pending; needs: rust-release-tag -->
```toml
[dependencies]
iceroot-sdk = { git = "https://github.com/iceroot-network/sdk-rust.git", tag = "v0.1.0", features = ["http"] }
```

- **Rust version.** The SDK needs Rust 1.98 or later (the same as Heartwood). Raise `rust-version` and any pinned toolchain or Docker image to match.
- **heartwood-core access.** The Rust SDK fetches `heartwood-crypto` from the public `https://github.com/iceroot-network/heartwood-core.git` repository without a key or token. Once fetched, builds work offline.
- **Docker builds.** Build with `RUN cargo build --release --locked`; no dependency credentials are needed.
- **Features.** `http` adds an async HTTP client (reqwest). Without it the crate is sans-IO: it builds requests and parses responses, and your code performs the HTTP calls. `serde` adds `Serialize` and `Deserialize` to the client's request values and answers, in the same JSON form the TypeScript package reads (camel-case fields, 64-bit and wider integers as decimal strings), for a backend that passes the records on to a web page.

The TypeScript package needs none of this: it ships the compiled module.
