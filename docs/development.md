# Development

## Building from source

A clean clone needs the following tools and the sibling Rust checkout:

- Rust 1.98 with the `wasm32-unknown-unknown` target;
- the `wasm-bindgen` CLI at the exact version of the `wasm-bindgen` crate in `wasm/Cargo.lock` (`cargo install wasm-bindgen-cli --version 0.2.129 --locked`);
- clang and llvm-ar with the wasm32 target, for libsecp256k1 (found as `clang` or `clang-N`, or set `CC_wasm32_unknown_unknown` and `AR_wasm32_unknown_unknown`);
- a checkout of [sdk-rust](https://github.com/iceroot-network/sdk-rust) next to this repository (`../sdk-rust`), which `wasm/Cargo.toml` uses by path. Use its `dev` branch for this development checkout; CI uses the target branch and release builds use the matching version tag. The Node client tests also read its recorded devnet answers;
- access to the public `https://github.com/iceroot-network/heartwood-core.git` dependency over HTTPS;
- Node 22 and `npm install`, which brings esbuild, TypeScript and `wasm-opt` (binaryen).

`rust-toolchain.toml` pins Rust 1.98.0, as sdk-rust and Heartwood Core. The build passes the compiler its own flags and ignores `RUSTFLAGS`: sha2's compact backend, which keeps the module small, and fixed names for the source directories (the Cargo home, sdk-rust and this repository), so that the module names no directory of the machine that built it. Two builds give the same module when they also use the same checkout paths, because Cargo hashes the absolute path of sdk-rust, a path dependency, into the crates' symbols; the release workflow always builds in the same place.

<!-- sample: plain -->
```sh
npm install
npm run build          # dist/: the three builds, the embedded-bytes file, the Tauri entry, declarations, SHA256SUMS
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
npm run check:types    # sources and an application's use of the declarations, TypeScript 7.0 and 5.7
npm run check:size     # the module at most 425 KiB gzipped
npm run check:notice   # NOTICE matches wasm/Cargo.lock and package-lock.json
npm run test:node      # Node: the Node, browser and classic-script builds; drafts across instances; @noble cross-check; the node API client
npm run test:browser   # Chromium: a page, a Vite and React app, a Manifest V3 extension
npm run test:webkit    # WebKit: a page and a Vite and React app (install WebKit first: npx playwright install webkit)
npm run test:tauri     # a Tauri 2 webview (WebKitGTK) under tauri-driver, in a container
npm run test:tauri-plugin  # the Tauri plugin (sdk-rust's tauri-plugin-iceroot) in the Tauri example, same container
npm run test:e2e       # Node, Chromium, the Tauri plugin, the quickstarts and the Rust SDK against a local devnet (see below)
```

| Environment | What runs |
|---|---|
| Node 22 | The Node build; the browser build with `init(bytes)`; the classic-script build and embedded bytes in an isolated scope with `initSync`; a transfer and a vote built and signed byte for byte as native Rust; a draft built in one module instance and signed in another; the wrapper's errors, phrases, amounts, capabilities and sign-in; the missing-randomness path; an independent check of the vectors with `@noble/curves`; the node API client against the devnet answers recorded in sdk-rust's `iceroot-sdk-api` fixtures (connect and the chain's identity, every read, relays, timeouts, the request budget and HTTP 429, submission within the pool's limits, waiting for inclusion, builders that read their facts from the node); 1,000 legacy passphrase keys, addresses and message signatures checked against `@noble/curves`, and 1,000 hardened derivations of 18, 21 and 24 words against `@scure/bip39` and `@scure/bip32`; the vote library's selection vectors and fixtures from sdk-rust (every mode's pools, weights and rank bands against an independently computed file), its reasons, notices, `check`, errors and `VoteSnapshot.fromNode` over the recorded devnet answers; every record of sdk-rust's keystore vectors (the published functions, and the test build's fixed salts and nonces), round trips and the wiping of every secret passed as bytes |
| Chromium and macOS WebKit | The browser build fetched by URL under `script-src 'self' 'wasm-unsafe-eval'`, with the vote library's selections and a keystore opened, and refused without `'wasm-unsafe-eval'` |
| Vite and React in Chromium and macOS WebKit | The package installed from its tarball; the production build under the page policy, and the development server |
| Manifest V3 extension | Playwright's persistent context: the wallet page (fetch), the sandbox page (`connect-src 'none'` kept, embedded bytes) and the service worker (embedded bytes); the same extension without `'wasm-unsafe-eval'` fails in all three |
| Tauri 2 on Linux | A Tauri application driven by `tauri-driver` and WebKitWebDriver: the vectors in the webview, and `connect` with the Tauri HTTP plugin's `fetch` as the transport, to a relay the webview's own policy does not allow; the same application without `'wasm-unsafe-eval'` fails |
| Tauri 2 on Linux, native plugin | `test:tauri-plugin`: the Tauri example (examples/tauri-plugin) built on sdk-rust's `tauri-plugin-iceroot` and driven by `tauri-driver`: its own page against a recorded devnet node; the native vectors through the published plugin, which refuses every test seam; then, through the plugin's test build (feature `test-seams`), the vectors byte for byte and the SDK's test suites (`test/suites`, the code the Node tests run through WebAssembly: the API, transactions, the vote library, the keystore, ownership proofs, the `@noble` and `@scure` cross-checks and the node API client against recorded nodes served over HTTP), and the plugin's own checks (relays limited to the capability, the page's own `fetch` reaching no node, released keys gone from the plugin, drafts read again from their bytes). The build runs in the container of `test:tauri`, as the invoking user, with the host's Cargo home fetched first |
| Native and WebAssembly | `check:differential`: 10,000 random phrases, passphrase keys and message signatures, amounts, addresses, transfers and votes through the bindings compiled natively and through the WebAssembly build behind the wrapper; then 10,000 random vote snapshots, each with a selection in a random mode and vote rules, a check against a changed snapshot, an evaluation, a vote validated and names split, compared as canonical JSON with every reason's sentence; results and errors must be identical |
| A local devnet | `test:e2e`, in Node and in Chromium at the same time, then through the Tauri plugin in the Tauri example: a new account from a recovery phrase, funded from a genesis wallet; a validator registration and a resignation, and a revoke that the node refuses because the new validator operates no node; transfers with a memo and to 256 recipients; a burn; a second key; votes; a transfer built in one WebAssembly instance and signed in another that cannot reach the network; the fee floor and one base unit below it. Every transaction is read back from the node and compared with what was signed. Then the documentation's quickstarts, assembled from their samples as a reader copies them and installed from the packed tarball: the Node script, the Manifest V3 extension in Playwright's persistent context, the Vite and React wallet, and the Next.js routes and client component (a webpack production build and the Turbopack development server). Then the Rust SDK's own devnet test, which also verifies the messages the TypeScript runs signed |

The live-devnet end-to-end test is maintainers-only. Its `ICEROOT_DEVNET_TOOLS` tooling is not public. It needs a local devnet of the reference implementation. `npm run test:e2e` starts one through sdk-rust's `tools/e2e/devnet.sh` (from the sdk-rust checkout next to this repository, or `SDK_RUST_DIR`), with `ICEROOT_DEVNET_TOOLS` pointing at the devnet tooling, and stops and removes it when the tests end; the chain never runs more than five rounds. The scenario reaches the node through the package's own client: `connect` (and a profile pinned to another chain, refused), the builders of `net.build`, which read each draft's facts from the node, `net.submit`, `net.transactions.wait` and the reads of histories, blocks, names and supply. Only the node's raw JSON of each forged transaction, which the test compares with what was signed, is read directly over `fetch` (`test/e2e/node-json.js`).

### Continuous integration

`.github/workflows/ci.yml` runs on pull requests to `dev` and `prod` and on pushes to `prod`. It checks out sdk-rust next to this repository at the branch the change targets, then runs every check and test above except the devnet test; the Tauri checks, of the webview and of the plugin, run as a job of their own, and the WebKit tests as another, on macOS. The packed tarball of each run is kept as a workflow artifact for a week.

The WebKit job (`macos-webkit`) runs on `macos-15`. Apple's clang cannot compile for wasm32, so it builds the module with Homebrew's LLVM 18, the version the Linux jobs use. It runs `test:webkit`: a page and a Vite and React app under the page policy, and the refusal without `'wasm-unsafe-eval'`, in Playwright's build of current WebKit. It does not check Safari itself, older Safari releases, iOS or the Tauri plugin on macOS.

The bindings build on sdk-rust, which fetches the public Heartwood Core repository over HTTPS without a dependency secret.

### Releasing

1. Release sdk-rust first, with the same version tag: the package is built from it.
2. Set `version` in `package.json` on `dev`, write what applications must know about it (changed or removed interfaces) in `release-notes/v<version>.md`, and merge `dev` into `prod` through a pull request.
3. Tag the merge commit on `prod` with `v` and the version, and push the tag: `git tag -a v0.1.0 -m "IceRoot SDK for TypeScript 0.1.0"`, then `git push origin v0.1.0`.
4. `.github/workflows/release.yml` checks out sdk-rust at the same tag, runs the checks and tests, packs the package with `npm pack` and publishes the GitHub release with its assets through `scripts/release.mjs`. The script refuses a tag that differs from the version or is not on `prod`, and checks every asset against `SHA256SUMS`. The notes carry the version's notes from `release-notes/` and the commits since the previous tag. `npm run pack && node scripts/release.mjs --tag v0.1.0 --no-build --dry-run` shows the notes and the assets without publishing.

## Notices

`NOTICE` lists what the package contains from others: Heartwood Core's notice, the Rust crates compiled into the module with their licences, copyright lines and licence texts, and the JavaScript side from `package-lock.json`. It is generated: after changing a dependency here or in sdk-rust, run `npm run notice` and commit the result.
