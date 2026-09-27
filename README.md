# IceRoot SDK (TypeScript)

The IceRoot SDK for TypeScript and JavaScript: the Rust core compiled to WebAssembly with a thin, typed wrapper. It runs in browsers, Next.js, Vite and React, Tauri webviews and Manifest V3 extensions.

The SDK is in early development and not yet published to a public registry. Today the package loads the WebAssembly module in every supported environment and offers, for today's devnet: `connect` with a pinned network identity, the network's rules and economics, every read of the node API as typed records, builders that read a draft's facts from the node and default to the exact fee floor, submission within the pool's limits, waiting for inclusion and watching by polling; recovery phrases and accounts, the legacy passphrase import, addresses, exact amounts, drafts of every operation with review summaries, signing in the same or another context, message signatures and the sign-in message; the vote library, which fills a vote in one of four modes and explains every pick (`@iceroot-network/sdk/vote`); and the keystore, a recovery phrase encrypted under a password (`@iceroot-network/sdk/keystore`).

## Install

Releases are published on GitHub, starting with 0.1.0. Each release attaches the package tarball, with the WebAssembly module already built, and its `SHA256SUMS`. Install a release by its URL; no registry account or token is needed:

<!-- sample: pending; needs: release-tarball -->
```sh
npm install https://github.com/iceroot-network/sdk-typescript/releases/download/v0.1.0/iceroot-network-sdk-0.1.0.tgz
```

<!-- sample: verified 0.1.0 -->
```ts
import { init, connect, profiles } from "@iceroot-network/sdk";

await init();
const net = await connect(profiles.devnet({ relays: ["http://127.0.0.1:6003/api"] }));
```

Each release attaches these assets:

| Asset | What it is |
|---|---|
| `iceroot-network-sdk-<version>.tgz` | The npm package, with the WebAssembly module built |
| `iceroot_sdk_bg.wasm`, `iceroot-sdk-bytes.js` | The module on its own, and as an embedded byte array, for hosts that serve them separately |
| `SHA256SUMS` | SHA-256 of each asset |

The release notes state the sdk-rust release and the `heartwood-crypto` revision the module is built from, the profiles it supports, the module's size and the changes. See [installation](docs/installation.md) for checking the sums, the entry points and the Rust crates.

## Documentation

The [documentation](docs/README.md) covers the API and how to wire the IceRoot apps to it:

- [Concepts](docs/concepts.md): profiles and networks, keys and recovery phrases, addresses, amounts, reads, transactions and drafts, message signing and sign-in, errors.
- [Vote selection](docs/vote.md): the four vote modes, the review screen's reasons, checking a vote later, manual votes.
- [Keystore](docs/keystore.md): a recovery phrase encrypted under a password, the presets per platform, opening and changing it.
- [Rules apps must never get wrong](docs/rules.md), with security notes and a review checklist.
- [Devnet](docs/devnet.md): the network to develop against.
- Quickstarts: [Node](docs/quickstart/node.md), [Vite and React](docs/quickstart/vite-react.md), [Next.js](docs/quickstart/nextjs.md), [Manifest V3 extension](docs/quickstart/mv3-extension.md), [Tauri desktop and mobile](docs/quickstart/tauri.md), [Rust backend](docs/quickstart/rust-backend.md).
- Integration guides: [explorer](docs/apps/explorer.md), [validators portal](docs/apps/validators.md), [desktop wallet](docs/apps/desktop-wallet.md), [mobile wallet](docs/apps/mobile-wallet.md), [browser wallet](docs/apps/browser-wallet.md).

Every code sample in the documentation is marked with its verification status. `node scripts/check-docs.mjs` checks the markers and the links; `--list` shows the samples still to be verified against a build. `npm run check:samples` type-checks every TypeScript sample marked verified against the build.

[Contributing](https://github.com/iceroot-network/.github/blob/prod/CONTRIBUTING.md). Work on `dev`. Production changes reach `prod` through a reviewed `dev` → `prod` pull request.

## Using the package

Every key, address, amount, draft and signature comes from the SDK's Rust core ([sdk-rust](https://github.com/iceroot-network/sdk-rust)), which builds on Heartwood Core's byte-exact `heartwood-crypto`, compiled to WebAssembly. Secret keys stay in WebAssembly memory: an `Account` exposes its public key and address, signs through the module, and `release()` wipes the key. The node API client is the same Rust code: it builds each request and decodes each answer, and the package sends them with `fetch` or the transport you pass to `connect`.

<!-- sample: verified 0.1.0 -->
```ts
import { connect, profiles, Amount, balanceOf } from "@iceroot-network/sdk";

const net = await connect(profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] }));
const info = await net.accounts.get(address);   // typed records; amounts are bigint base units
Amount.format(balanceOf(info), net.token.decimals);

const draft = await net.build.transfer({ from: account, to: [{ address: recipient, amount: 150_000_000n }] });   // the fee is the exact floor
const signed = draft.sign(account);
const outcome = await net.submit(signed);        // { id, status: "accepted", broadcast } or { id, status: "rejected", reason, nodeCode, message }
if (outcome.status === "accepted") await net.transactions.wait(signed.id);   // polls until the transaction is in a block
```

Offline, from a configuration you already hold:

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
    // No fee given: "minimum", the exact fee floor of the milestone in force.
  },
  { sender: account, nonce: 1n, height: 2 },
);
draft.summary.lines; // what the review screen shows, the fee included
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
| `@iceroot-network/sdk/vote`, `@iceroot-network/sdk/keystore` | `dist/node`, `dist/web` | The vote library and the keystore, as the root entry loads; they share its module |
| `@iceroot-network/sdk/iife` | `dist/iife/iceroot-sdk.js` | A classic script that defines one global, `IceRootSdk`, with the vote library and the keystore as `IceRootSdk.vote` and `IceRootSdk.keystore`; `IceRootSdk.init()` fetches `iceroot-sdk_bg.wasm` next to the script |
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
- a checkout of [sdk-rust](https://github.com/iceroot-network/sdk-rust) next to this repository (`../sdk-rust`), which `wasm/Cargo.toml` uses by path until sdk-rust has a tagged release, and whose recorded devnet answers the Node tests of the node API client read;
- read access to `heartwood-core`, which sdk-rust fetches over SSH from `github.com` (see sdk-rust's README, also for a key behind an SSH host alias; `.cargo/config.toml` makes cargo use the git command line and its SSH configuration);
- Node 22 and `npm install`, which brings esbuild, TypeScript and `wasm-opt` (binaryen).

`rust-toolchain.toml` pins Rust 1.98.0, as sdk-rust and Heartwood Core. The build passes the compiler its own flags and ignores `RUSTFLAGS`: sha2's compact backend, which keeps the module small, and fixed names for the source directories (the Cargo home, sdk-rust and this repository), so that the module names no directory of the machine that built it. Two builds give the same module when they also use the same checkout paths, because Cargo hashes the absolute path of sdk-rust, a path dependency, into the crates' symbols; the release workflow always builds in the same place.

<!-- sample: plain -->
```sh
npm install
npm run build          # dist/: the three builds, the embedded-bytes file, declarations, SHA256SUMS
npm run build:test     # build/test/dist/: the same with reproducible signatures, for tests only
npm run pack           # build/pack/: the tarball, the module and SHA256SUMS for a release
```

The build compiles `wasm/` for `wasm32-unknown-unknown` (the test build with the test seams: reproducible signatures, and the keystore vectors' salts, nonces and lowered parameter floor), runs `wasm-bindgen` for the `web`, `experimental-nodejs-module` and `no-modules` targets, optimizes the module once with `wasm-opt -Oz`, bundles the wrapper for each target with esbuild and emits the declarations with TypeScript. The WebAssembly build uses libsecp256k1's small precomputed tables (`lowmemory`); keys and signatures are identical with either table size.

## Tests and checks

The tests compare every environment with native Rust. `test/vectors/wasm-native.json` holds what the SDK's Rust core computes natively (`wasm/examples/vectors.rs`): keys from legacy passphrases and from recovery phrases, addresses and address checks, phrase checks, amounts, message signatures, drafts of every operation with their signed transactions on a devnet chain, vote selections in every mode, and a keystore with the phrase it holds. Each environment runs the same checks (`test/shared/vector-checks.js`) and must reproduce them. The test build can sign with the vectors' fixed auxiliary bytes, so it also compares signature and transaction bytes; the published build cannot choose that randomness, so there the vectors' signatures and transactions must verify, and fresh signatures and transactions must verify over the native unsigned bytes. Every environment also sends a draft through its serialized form and signs it again.

<!-- sample: plain -->
```sh
npm run check:docs     # the documentation's sample markers, links and anchors
npm run check:samples  # every TypeScript sample marked verified type-checks against dist/, TypeScript 7.0 and 5.7
npm run check:rust     # rustfmt, clippy (native and wasm32) with warnings as errors
npm run test:rust      # the bindings' unit tests in native Rust
npm run check:vectors  # the vector file equals what native Rust produces now
npm run check:differential  # 10,000 random cases and 10,000 random vote snapshots give the same results natively and in WebAssembly
npm run check:types    # sources and an app's use of the declarations, TypeScript 7.0 and 5.7
npm run check:size     # the module at most 400 KiB gzipped
npm run check:notice   # NOTICE matches wasm/Cargo.lock and package-lock.json
npm run test:node      # Node: the Node, browser and classic-script builds; drafts across instances; @noble cross-check; the node API client
npm run test:browser   # Chromium: a page, a Vite and React app, a Manifest V3 extension
npm run test:tauri     # a Tauri 2 webview (WebKitGTK) under tauri-driver, in a container
npm run test:e2e       # Node, Chromium, the quickstarts and the Rust SDK against a local devnet (see below)
```

| Environment | What runs |
|---|---|
| Node 22 | The Node build; the browser build with `init(bytes)`; the classic-script build and embedded bytes in an isolated scope with `initSync`; a transfer and a vote built and signed byte for byte as native Rust; a draft built in one module instance and signed in another; the wrapper's errors, phrases, amounts, capabilities and sign-in; the missing-randomness path; an independent check of the vectors with `@noble/curves`; the node API client against the devnet answers recorded in sdk-rust's `iceroot-sdk-api` fixtures (connect and the chain's identity, every read, relays, timeouts, the request budget and HTTP 429, submission within the pool's limits, waiting for inclusion, builders that read their facts from the node); 1,000 legacy passphrase keys, addresses and message signatures checked against `@noble/curves`, and 1,000 hardened derivations of 18, 21 and 24 words against `@scure/bip39` and `@scure/bip32`; the vote library's selection vectors and fixtures from sdk-rust (every mode's pools, weights and rank bands against an independently computed file), its reasons, notices, `check`, errors and `VoteSnapshot.fromNode` over the recorded devnet answers; every record of sdk-rust's keystore vectors (the published functions, and the test build's fixed salts and nonces), round trips and the wiping of every secret passed as bytes |
| Chromium | The browser build fetched by URL under `script-src 'self' 'wasm-unsafe-eval'`, with the vote library's selections and a keystore opened, and refused without `'wasm-unsafe-eval'` |
| Vite and React in Chromium | The package installed from its tarball; the production build under the page policy, and the development server |
| Manifest V3 extension | Playwright's persistent context: the wallet page (fetch), the sandbox page (`connect-src 'none'` kept, embedded bytes) and the service worker (embedded bytes); the same extension without `'wasm-unsafe-eval'` fails in all three |
| Tauri 2 on Linux | A Tauri application driven by `tauri-driver` and WebKitWebDriver: the vectors in the webview, and `connect` with the Tauri HTTP plugin's `fetch` as the transport, to a relay the webview's own policy does not allow; the same application without `'wasm-unsafe-eval'` fails |
| Native and WebAssembly | `check:differential`: 10,000 random phrases, passphrase keys and message signatures, amounts, addresses, transfers and votes through the bindings compiled natively and through the WebAssembly build behind the wrapper; then 10,000 random vote snapshots, each with a selection in a random mode and vote rules, a check against a changed snapshot, an evaluation, a vote validated and names split, compared as canonical JSON with every reason's sentence; results and errors must be identical |
| A local devnet | `test:e2e`, in Node and in Chromium at the same time: a new account from a recovery phrase, funded from a genesis wallet; a validator registration and a resignation, and a revoke that the node refuses because the new validator operates no node; transfers with a memo and to 256 recipients; a burn; a second key; votes; a transfer built in one WebAssembly instance and signed in another that cannot reach the network; the fee floor and one base unit below it. Every transaction is read back from the node and compared with what was signed. Then the documentation's quickstarts, assembled from their samples as a reader copies them and installed from the packed tarball: the Node script, the Manifest V3 extension in Playwright's persistent context, the Vite and React wallet, and the Next.js routes and client component (a webpack production build and the Turbopack development server). Then the Rust SDK's own devnet test, which also verifies the messages the TypeScript runs signed |

The devnet test needs a local devnet of the reference implementation. `npm run test:e2e` starts one through sdk-rust's `tools/e2e/devnet.sh` (from the sdk-rust checkout next to this repository, or `SDK_RUST_DIR`), with `ICEROOT_DEVNET_TOOLS` pointing at the devnet tooling, and stops and removes it when the tests end; the chain never runs more than five rounds. The scenario reaches the node through the package's own client: `connect` (and a profile pinned to another chain, refused), the builders of `net.build`, which read each draft's facts from the node, `net.submit`, `net.transactions.wait` and the reads of histories, blocks, names and supply. Only the node's raw JSON of each forged transaction, which the test compares with what was signed, is read directly over `fetch` (`test/e2e/node-json.js`).

### Continuous integration

`.github/workflows/ci.yml` runs on pull requests to `dev` and `prod` and on pushes to `prod`. It checks out sdk-rust next to this repository at the branch the change targets, then runs every check and test above; the Tauri check runs as a job of its own. The packed tarball of each run is kept as a workflow artifact for a week.

The bindings build on sdk-rust, which reads `heartwood-core` over SSH. The workflows use a read-only deploy key of `heartwood-core`, stored in this repository as the secret `HEARTWOOD_DEPLOY_KEY`; `scripts/ci/heartwood-access.sh` installs it under an SSH host alias of its own and rewrites `heartwood-core`'s `github.com` address to that alias, so the key serves that repository only. Pull requests from forks get no secrets, so their runs stop at that step. While `heartwood-core` is private, only pull request runs save the dependency cache: it holds Cargo's copy of `heartwood-core`, and a pull request from a fork can restore the caches of this repository's branches.

### Releasing

1. Release sdk-rust first, with the same version tag: the package is built from it.
2. Set `version` in `package.json` on `dev`, write what applications must know about it (changed or removed interfaces) in `release-notes/v<version>.md`, and merge `dev` into `prod` through a pull request.
3. Tag the merge commit on `prod` with `v` and the version, and push the tag: `git tag -a v0.1.0 -m "IceRoot SDK for TypeScript 0.1.0"`, then `git push origin v0.1.0`.
4. `.github/workflows/release.yml` checks out sdk-rust at the same tag, runs the checks and tests, packs the package with `npm pack` and publishes the GitHub release with its assets through `scripts/release.mjs`. The script refuses a tag that differs from the version or is not on `prod`, and checks every asset against `SHA256SUMS`. The notes carry the version's notes from `release-notes/` and the commits since the previous tag. `npm run pack && node scripts/release.mjs --tag v0.1.0 --no-build --dry-run` shows the notes and the assets without publishing.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). The WebAssembly module contains compiled code of Heartwood Core; see [NOTICE](NOTICE).

`NOTICE` lists what the package contains from others: Heartwood Core's notice, the Rust crates compiled into the module with their licences, copyright lines and licence texts, and the JavaScript side from `package-lock.json`. It is generated: after changing a dependency here or in sdk-rust, run `npm run notice` and commit the result.
