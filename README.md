# IceRoot SDK (TypeScript)

The IceRoot SDK for TypeScript and JavaScript: the Rust core compiled to WebAssembly with a thin, typed wrapper. It runs in browsers, Next.js, Vite and React, Tauri webviews and Manifest V3 extensions.

The SDK is in early development and not yet published to a public registry. Today the package loads the WebAssembly module in every supported environment and offers legacy passphrase keys, devnet addresses and message signatures. Recovery phrases, transactions, the node client, sign-in and the vote library arrive with the Rust core; their types are already in place.

[Contributing](https://github.com/iceroot-network/.github/blob/prod/CONTRIBUTING.md). Work on `dev`. Production changes reach `prod` through a reviewed `dev` → `prod` pull request.

## Using the package

Keys, addresses and signatures come from Heartwood Core's byte-exact `heartwood-crypto` crate, compiled to WebAssembly. Secret keys stay in WebAssembly memory: an `Account` exposes its public key and address, signs through the module, and `release()` wipes the key.

```ts
import { init, Keys, Messages, Address, profiles } from "@iceroot-network/sdk";

await init(); // once, before anything else; the Node build needs no call

const devnet = profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] });
const account = Keys.fromLegacyPassphrase("devnet passphrase", devnet);
account.address; // "d..." on network byte 90

const signed = Messages.sign(account, "hello");
Messages.verify({ ...signed, message: "hello" }, devnet); // true
Address.check("dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF", devnet); // { ok: true }
account.release();
```

Every error is an `IceRootError` with a stable `code` (for example `InvalidAddress` with a `reason` of `checksum`, `length`, `wrong-network` or `format`). A call before initialization throws `SdkNotInitialized`; a module that cannot be loaded, for example under a content security policy without `'wasm-unsafe-eval'`, rejects with `WasmLoadFailed`.

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
- read access to `heartwood-core`, which `wasm/Cargo.toml` fetches over SSH (`.cargo/config.toml` makes cargo use the git command line and its SSH configuration);
- Node 22 and `npm install`, which brings esbuild, TypeScript and `wasm-opt` (binaryen).

```sh
npm install
npm run build          # dist/: the three builds, the embedded-bytes file, declarations, SHA256SUMS
npm run build:test     # build/test/dist/: the same with reproducible signatures, for tests only
npm run pack           # build/pack/: the tarball, the module and SHA256SUMS for a release
```

The build compiles `wasm/` for `wasm32-unknown-unknown`, runs `wasm-bindgen` for the `web`, `experimental-nodejs-module` and `no-modules` targets, optimizes the module once with `wasm-opt -Oz`, bundles the wrapper for each target with esbuild and emits the declarations with TypeScript. The WebAssembly build uses libsecp256k1's small precomputed tables (`lowmemory`); keys and signatures are identical with either table size.

## Tests and checks

The tests compare every environment with native Rust. `test/vectors/wasm-native.json` holds keys, addresses, message signatures and address checks computed natively by `wasm/examples/vectors.rs` with `heartwood-crypto`; each environment runs the same checks (`test/shared/vector-checks.js`) and must reproduce them. The test build can sign with the vectors' fixed auxiliary bytes, so it also compares signature bytes; the published build cannot choose that randomness, so there the vectors' signatures must verify and fresh signatures must verify.

```sh
npm run check:rust     # rustfmt, clippy (native and wasm32) with warnings as errors
npm run test:rust      # the bindings' unit tests in native Rust
npm run check:vectors  # the vector file equals what native Rust produces now
npm run check:types    # sources and an app's use of the declarations, TypeScript 7.0 and 5.7
npm run check:size     # the module at most 300 KB gzipped
npm run test:node      # Node: the Node, browser and classic-script builds; @noble cross-check
npm run test:browser   # Chromium: a page, a Vite and React app, a Manifest V3 extension
npm run test:tauri     # a Tauri 2 webview (WebKitGTK) under tauri-driver, in a container
```

| Environment | What runs |
|---|---|
| Node 22 | The Node build; the browser build with `init(bytes)`; the classic-script build and embedded bytes in an isolated scope with `initSync`; the missing-randomness path; an independent check of the vectors with `@noble/curves` |
| Chromium | The browser build fetched by URL under `script-src 'self' 'wasm-unsafe-eval'`, and refused without `'wasm-unsafe-eval'` |
| Vite and React in Chromium | The package installed from its tarball; the production build under the page policy, and the development server |
| Manifest V3 extension | Playwright's persistent context: the wallet page (fetch), the sandbox page (`connect-src 'none'` kept, embedded bytes) and the service worker (embedded bytes); the same extension without `'wasm-unsafe-eval'` fails in all three |
| Tauri 2 on Linux | A Tauri application driven by `tauri-driver` and WebKitWebDriver; the same application without `'wasm-unsafe-eval'` fails |

## License

Licensed under the [Apache License, Version 2.0](LICENSE). The WebAssembly module contains compiled code of Heartwood Core; see [NOTICE](NOTICE).
