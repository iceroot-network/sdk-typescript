# IceRoot SDK (TypeScript)

The IceRoot SDK for TypeScript and JavaScript: the Rust core compiled to WebAssembly with a thin, typed wrapper. It runs in browsers, Next.js, Vite and React, Tauri webviews and Manifest V3 extensions.

The SDK is in early development and not yet published to a public registry.

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

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
