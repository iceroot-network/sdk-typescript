# IceRoot SDK (TypeScript)

The IceRoot SDK for TypeScript and JavaScript: the Rust core compiled to WebAssembly with a thin, typed wrapper. It runs in browsers, Next.js, Vite and React, Tauri webviews and Manifest V3 extensions.

The SDK is in early development and not yet published to a public registry. Today the package loads the WebAssembly module in every supported environment and offers, for today's devnet: recovery phrases and accounts, the legacy passphrase import, addresses, exact amounts, the network's rules and economics, drafts of every operation with review summaries, signing in the same or another context, message signatures and the sign-in message. The typed values of the node API client are in place; `connect`, reads, submission and the vote library come next.

## Install

Releases are published on GitHub, starting with 0.1.0. Each release attaches the package tarball, with the WebAssembly module already built, and its `SHA256SUMS`. Install a release by its URL; no registry account or token is needed:

<!-- sample: pending; needs: release-tarball -->
```sh
npm install https://github.com/iceroot-network/sdk-typescript/releases/download/v0.1.0/iceroot-network-sdk-0.1.0.tgz
```

<!-- sample: pending; needs: init, connect, profiles.devnet -->
```ts
import { init, connect, profiles } from "@iceroot-network/sdk";

await init();
const net = await connect(profiles.devnet({ relays: ["http://127.0.0.1:6003/api"] }));
```

See [installation](docs/installation.md) for checksums, entry points and the Rust crates.

## Documentation

The [documentation](docs/README.md) covers the API and how to wire the IceRoot apps to it:

- [Concepts](docs/concepts.md): profiles and networks, keys and recovery phrases, addresses, amounts, reads, transactions and drafts, message signing and sign-in, errors.
- [Rules apps must never get wrong](docs/rules.md), with security notes and a review checklist.
- [Devnet](docs/devnet.md): the network to develop against.
- Quickstarts: [Node](docs/quickstart/node.md), [Vite and React](docs/quickstart/vite-react.md), [Next.js](docs/quickstart/nextjs.md), [Manifest V3 extension](docs/quickstart/mv3-extension.md), [Tauri desktop and mobile](docs/quickstart/tauri.md), [Rust backend](docs/quickstart/rust-backend.md).
- Integration guides: [explorer](docs/apps/explorer.md), [validators portal](docs/apps/validators.md), [desktop wallet](docs/apps/desktop-wallet.md), [mobile wallet](docs/apps/mobile-wallet.md), [browser wallet](docs/apps/browser-wallet.md).

Every code sample in the documentation is marked with its verification status. `node scripts/check-docs.mjs` checks the markers and the links; `--list` shows the samples still to be verified against a build.

[Contributing](https://github.com/iceroot-network/.github/blob/prod/CONTRIBUTING.md). Work on `dev`. Production changes reach `prod` through a reviewed `dev` → `prod` pull request.

## Using the package

Every key, address, amount, draft and signature comes from the SDK's Rust core ([sdk-rust](https://github.com/iceroot-network/sdk-rust)), which builds on Heartwood Core's byte-exact `heartwood-crypto`, compiled to WebAssembly. Secret keys stay in WebAssembly memory: an `Account` exposes its public key and address, signs through the module, and `release()` wipes the key.

<!-- sample: verified 0.1.0 -->
```ts
import { init, Address, Amount, Chain, Draft, Keys, Messages, Mnemonic, profiles } from "@iceroot-network/sdk";

await init(); // once, before anything else; the Node build needs no call

// The chain a node serves: the data object of its /node/configuration/crypto.
const chain = Chain.load(profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] }), configuration);
const profile = chain.profile; // keep it: the network hash is pinned from now on

const phrase = Mnemonic.generate(); // 24 words
const account = Keys.fromPhrase(phrase, profile, { account: 0, index: 0 });
account.address; // "d..." on network byte 90

// Facts only the node knows: the sender's next nonce and the next block's height.
const draft = Draft.build(
  chain,
  {
    operation: { kind: "transfer", to: [{ address: Address.parse(recipient, profile), amount: Amount.parse("1.5", chain.token.decimals) }] },
    memo: "invoice 42",
    fee: 1_000_000n,
  },
  { sender: account, nonce: 1n, height: 2 },
);
draft.summary.lines; // what the review screen shows
const signed = draft.sign(account);
signed.id; // and signed.json for the node

const signature = Messages.sign(account, "hello");
Messages.verify({ ...signature, message: "hello" }, profile); // true
account.release();
```

A draft can also be built where the network is and signed where the key is: `Draft.deserialize(draft.serialize(), profile)` in the signing context (for example a Manifest V3 sandbox page with no network), then `SignedTransaction.deserialize(signed.serialize(), profile)` on the way back. Both refuse data of another network.

Every error is an `IceRootError` with a stable `code` shared with the Rust core (for example `InvalidAddress` with a `reason` of `checksum`, `length`, `wrong-network` or `format`, or `InvalidVote` with the rule it breaks). A call before initialization throws `SdkNotInitialized`; a module that cannot be loaded, for example under a content security policy without `'wasm-unsafe-eval'`, rejects with `WasmLoadFailed`.

### Builds and where they load

| Entry | Build | How it loads |
|---|---|---|
| `@iceroot-network/sdk` in Node 22 | `dist/node` | Synchronously, when imported |
| `@iceroot-network/sdk` in browsers and bundlers | `dist/web` | `await init()` fetches `iceroot_sdk_bg.wasm` next to the build; `init(source)` takes a URL, a `Response` or bytes instead |
| `@iceroot-network/sdk/iife` | `dist/iife/iceroot-sdk.js` | A classic script that defines one global, `IceRootSdk`; `IceRootSdk.init()` fetches `iceroot-sdk_bg.wasm` next to the script |
| `@iceroot-network/sdk/iife/bytes` | `dist/iife/iceroot-sdk-bytes.js` | A classic script that defines `IceRootSdkWasmBytes`, the module as bytes, for `IceRootSdk.initSync(IceRootSdkWasmBytes)` where fetching is not possible |
| `@iceroot-network/sdk/wasm` | `dist/web/iceroot_sdk_bg.wasm` | The module itself, for hosts that serve it elsewhere |

All builds contain the same module; `dist/SHA256SUMS` lists every file.

### Settings per environment

- **Content security policy.** Pages need `script-src 'self' 'wasm-unsafe-eval'`. Without `'wasm-unsafe-eval'` the browser refuses to compile the module.
- **Vite.** Exclude the package from dependency pre-bundling, which would separate the JavaScript from its `.wasm` file: `optimizeDeps: { exclude: ["@iceroot-network/sdk"] }`.
- **Manifest V3 extensions.** Add `'wasm-unsafe-eval'` to `content_security_policy.extension_pages`, to `content_security_policy.sandbox` and to the sandbox page's own policy. Extension pages load `iceroot-sdk.js` and call `IceRootSdk.init()`. The sandbox page keeps `connect-src 'none'` and loads `iceroot-sdk.js` and `iceroot-sdk-bytes.js`, then calls `IceRootSdk.initSync(IceRootSdkWasmBytes)`. The service worker does the same with `importScripts`, so the module is ready when the worker starts.
- **Tauri 2.** Add `'wasm-unsafe-eval'` to `script-src` in `app.security.csp`.

## Building from source

Consumers of the package need none of this. Builders need:

- Rust 1.98 with the `wasm32-unknown-unknown` target;
- the `wasm-bindgen` CLI at the exact version of the `wasm-bindgen` crate in `wasm/Cargo.lock` (`cargo install wasm-bindgen-cli --version 0.2.129 --locked`);
- clang and llvm-ar with the wasm32 target, for libsecp256k1 (found as `clang` or `clang-N`, or set `CC_wasm32_unknown_unknown` and `AR_wasm32_unknown_unknown`);
- a checkout of [sdk-rust](https://github.com/iceroot-network/sdk-rust) next to this repository (`../sdk-rust`), which `wasm/Cargo.toml` uses by path until sdk-rust has a tagged release;
- read access to `heartwood-core`, which sdk-rust fetches over SSH through the host alias `github-iceroot` (see sdk-rust's README; `.cargo/config.toml` makes cargo use the git command line and its SSH configuration);
- Node 22 and `npm install`, which brings esbuild, TypeScript and `wasm-opt` (binaryen).

<!-- sample: plain -->
```sh
npm install
npm run build          # dist/: the three builds, the embedded-bytes file, declarations, SHA256SUMS
npm run build:test     # build/test/dist/: the same with reproducible signatures, for tests only
npm run pack           # build/pack/: the tarball, the module and SHA256SUMS for a release
```

The build compiles `wasm/` for `wasm32-unknown-unknown`, runs `wasm-bindgen` for the `web`, `experimental-nodejs-module` and `no-modules` targets, optimizes the module once with `wasm-opt -Oz`, bundles the wrapper for each target with esbuild and emits the declarations with TypeScript. The WebAssembly build uses libsecp256k1's small precomputed tables (`lowmemory`); keys and signatures are identical with either table size.

## Tests and checks

The tests compare every environment with native Rust. `test/vectors/wasm-native.json` holds what the SDK's Rust core computes natively (`wasm/examples/vectors.rs`): keys from legacy passphrases and from recovery phrases, addresses and address checks, phrase checks, amounts, message signatures, and drafts of every operation with their signed transactions on a devnet chain. Each environment runs the same checks (`test/shared/vector-checks.js`) and must reproduce them. The test build can sign with the vectors' fixed auxiliary bytes, so it also compares signature and transaction bytes; the published build cannot choose that randomness, so there the vectors' signatures and transactions must verify, and fresh signatures and transactions must verify over the native unsigned bytes. Every environment also sends a draft through its serialized form and signs it again.

<!-- sample: plain -->
```sh
npm run check:docs     # the documentation's sample markers, links and anchors
npm run check:rust     # rustfmt, clippy (native and wasm32) with warnings as errors
npm run test:rust      # the bindings' unit tests in native Rust
npm run check:vectors  # the vector file equals what native Rust produces now
npm run check:types    # sources and an app's use of the declarations, TypeScript 7.0 and 5.7
npm run check:size     # the module at most 300 KB gzipped
npm run test:node      # Node: the Node, browser and classic-script builds; drafts across instances; @noble cross-check
npm run test:browser   # Chromium: a page, a Vite and React app, a Manifest V3 extension
npm run test:tauri     # a Tauri 2 webview (WebKitGTK) under tauri-driver, in a container
```

| Environment | What runs |
|---|---|
| Node 22 | The Node build; the browser build with `init(bytes)`; the classic-script build and embedded bytes in an isolated scope with `initSync`; a transfer and a vote built and signed byte for byte as native Rust; a draft built in one module instance and signed in another; the wrapper's errors, phrases, amounts, capabilities and sign-in; the missing-randomness path; an independent check of the vectors with `@noble/curves`; 1,000 legacy passphrase keys, addresses and message signatures checked against `@noble/curves`, and 1,000 hardened derivations of 18, 21 and 24 words against `@scure/bip39` and `@scure/bip32` |
| Chromium | The browser build fetched by URL under `script-src 'self' 'wasm-unsafe-eval'`, and refused without `'wasm-unsafe-eval'` |
| Vite and React in Chromium | The package installed from its tarball; the production build under the page policy, and the development server |
| Manifest V3 extension | Playwright's persistent context: the wallet page (fetch), the sandbox page (`connect-src 'none'` kept, embedded bytes) and the service worker (embedded bytes); the same extension without `'wasm-unsafe-eval'` fails in all three |
| Tauri 2 on Linux | A Tauri application driven by `tauri-driver` and WebKitWebDriver; the same application without `'wasm-unsafe-eval'` fails |

## License

Licensed under the [Apache License, Version 2.0](LICENSE). The WebAssembly module contains compiled code of Heartwood Core; see [NOTICE](NOTICE).
