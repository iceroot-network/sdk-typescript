# Example: a Tauri app on the SDK's native plugin

A Tauri 2 application whose page uses the IceRoot SDK through its native plugin, `tauri-plugin-iceroot` from [sdk-rust](https://github.com/iceroot-network/sdk-rust): the page imports the package's Tauri entry (`@iceroot-network/sdk/tauri`), and keys, signing, the keystore and every request to the node run in the plugin, in Rust. It is the working code of the [Tauri quickstart](../../docs/quickstart/tauri.md). Devnet tokens have no value.

| Part | What it does | Files |
|---|---|---|
| The application | Registers the plugin; the same `run` serves desktop (`main.rs`) and mobile (the library a mobile project loads) | `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `src-tauri/Cargo.toml` |
| Capability | Grants the plugin's commands and the one relay the plugin may reach | `src-tauri/capabilities/main.json` |
| Policy | `script-src 'self'` and `connect-src 'self' ipc: http://ipc.localhost`: no `'wasm-unsafe-eval'`, no node origin | `src-tauri/tauri.conf.json` |
| The page | Connects and shows the pinned chain and its rules; creates a phrase, encrypts it into a keystore with the desktop preset, opens the account from the keystore in the plugin (the phrase never enters the page again) and shows its balance; signs and verifies a message | `frontend/index.html`, `frontend/main.js` |

The page imports the Tauri entry from `frontend/vendor/iceroot-sdk/tauri/`, a copy of the package's `dist/tauri` made by `prepare.mjs`, since it has no bundler; an application imports `@iceroot-network/sdk/tauri` from its bundler instead.

## Run it

You need the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) (on Linux, the WebKitGTK 4.1 and GTK 3 development files), Rust 1.98 or later with read access to `heartwood-core` (see [Installation](../../docs/installation.md#rust)), sdk-rust checked out next to this repository (the application depends on the plugin by path until sdk-rust has a release tag), and a devnet whose relay is `http://127.0.0.1:6003/api` (see [Devnet](../../docs/devnet.md)), or another relay allowed in the capability.

In this repository, after `npm install` and `npm run build` at its root:

```sh
node examples/tauri-plugin/prepare.mjs
cd examples/tauri-plugin/src-tauri && cargo run --release
```

For Android, the application builds as the library an Android project loads, with the Android NDK's clang for the C code and as the linker (`cargo build --release --lib --target aarch64-linux-android`, with `CC_aarch64_linux_android`, `AR_aarch64_linux_android` and `CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER` pointing at the NDK). An iOS build needs a Mac with Xcode.

## Tested

`npm run test:tauri-plugin` builds this application in a container on Linux (WebKitGTK) and drives it with `tauri-driver`: its own page against a recorded devnet node (connect, create, keep, open, sign); then, with a test page in place of this one, the SDK's native vectors through the published plugin, which must refuse every test seam, and the vectors and the SDK's test suites (`test/suites`, the same code the Node tests run through WebAssembly) through the plugin's test build. `npm run test:e2e -- --only tauri` runs the devnet scenario through the plugin against a fresh local devnet.
