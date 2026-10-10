# IceRoot SDK (TypeScript)

The IceRoot SDK for TypeScript and JavaScript is the SDK's Rust core compiled to WebAssembly with a typed wrapper. It runs in browsers, Next.js, Vite and React, Tauri webviews, Manifest V3 extensions and Node.

## Status

> Pre-release. Only devnet and classical formats are supported today. The API may change before 1.0. The package is not published to npm, and no release is available yet. A release tarball will be attached to the first GitHub release.

## Install

Build from source today. First install the tools listed in [Development](docs/development.md#building-from-source), including Rust, wasm-bindgen and a wasm32-capable clang. Check out both repositories beside each other:

<!-- sample: plain -->
```sh
git clone --branch prod https://github.com/iceroot-network/sdk-rust.git
git clone --branch prod https://github.com/iceroot-network/sdk-typescript.git
cd sdk-typescript
npm install
npm run pack
# In your application, install the generated tarball:
npm install ../sdk-typescript/build/pack/iceroot-network-sdk-0.1.0.tgz
```

The release install line will follow the first release. The v0.1.0 download URL is not available yet. See [Installation](docs/installation.md) for package layouts and download verification.

## Quickstart

With a running local devnet at the relay below, create an account and read its balance. This example does not fund it. Keep the recovery phrase safe and out of logs.

<!-- sample: verified 0.1.0 -->
```ts
import { init, connect, profiles, Mnemonic, Amount, balanceOf } from "@iceroot-network/sdk";

await init();
const relay = "http://127.0.0.1:6003/api";
const net = await connect(profiles.devnet({ relays: [relay] }));
const phrase = Mnemonic.generate();
const account = net.keys.fromPhrase(phrase, { account: 0, index: 0 });
try {
  console.log(account.address);
  const info = await net.accounts.get(account.address);
  console.log(Amount.format(balanceOf(info), net.token.decimals));
} finally {
  account.release();
}
```

The [Node quickstart](docs/quickstart/node.md) also funds an account and sends a transfer.

## Entry points

| Entry | Build | How it loads |
|---|---|---|
| `@iceroot-network/sdk` in Node 22 | `dist/node` | Synchronously, when imported |
| `@iceroot-network/sdk` in browsers and bundlers | `dist/web` | `await init()` fetches `iceroot_sdk_bg.wasm` next to the build; `init(source)` takes a URL, a `Response` or bytes instead |
| `@iceroot-network/sdk/vote`, `@iceroot-network/sdk/keystore`, `@iceroot-network/sdk/ownership` | `dist/node`, `dist/web` | The vote library, the keystore and the ownership proofs, as the root entry loads; they share its module |
| `@iceroot-network/sdk/iife` | `dist/iife/iceroot-sdk.js` | A classic script that defines one global, `IceRootSdk`, with the vote library, the keystore and the ownership proofs as `IceRootSdk.vote`, `IceRootSdk.keystore` and `IceRootSdk.ownership`; `IceRootSdk.init()` fetches `iceroot-sdk_bg.wasm` next to the script |
| `@iceroot-network/sdk/iife/bytes` | `dist/iife/iceroot-sdk-bytes.js` | A classic script that defines `IceRootSdkWasmBytes`, the module as bytes, for `IceRootSdk.initSync(IceRootSdkWasmBytes)` where fetching is not possible |
| `@iceroot-network/sdk/wasm` | `dist/web/iceroot_sdk_bg.wasm` | The module itself, for hosts that serve it elsewhere |
| `@iceroot-network/sdk/tauri`, `/tauri/vote`, `/tauri/keystore`, `/tauri/ownership` | `dist/tauri` | No module: every call goes to the Tauri plugin through Tauri's IPC; `await init()` checks that the plugin is registered and allowed |

All the WebAssembly builds contain the same module; `dist/SHA256SUMS` lists every file.

The size check limits the shared WebAssembly module to 425 KiB gzipped.

## Documentation

Read the [SDK documentation](https://docs.iceroot.com/developers/sdk) or browse the repository's [docs folder](docs/README.md). Start with [Concepts](docs/concepts.md), then choose a host quickstart. The [example wallet](examples/vite-react-wallet/README.md) and [Tauri example](examples/tauri-plugin/README.md) show complete applications.

## Security

Report vulnerabilities using the [security policy](https://github.com/iceroot-network/.github/blob/prod/SECURITY.md). Do not open public issues for vulnerabilities.

## Contributing

See [Contributing](https://github.com/iceroot-network/.github/blob/prod/CONTRIBUTING.md). Pull requests go against `dev`. Build, test and release instructions are in [Development](docs/development.md).

## Licence

Licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) for third-party notices.
