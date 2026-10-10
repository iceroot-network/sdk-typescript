# IceRoot SDK documentation

These pages explain how to use the SDK in wallets, explorers and services.

This package compiles the Rust core to WebAssembly with a typed wrapper. [sdk-rust](https://github.com/iceroot-network/sdk-rust) provides the native Rust interface. Both share types and rules. The [Rust backend quickstart](quickstart/rust-backend.md) shows native network access.

## Status of these pages

The package is pre-release and supports today's classical devnet formats. Samples keep their verification markers (see [Sample status](#sample-status)). `verified 0.1.0` names the package version used for checking, not a published release. `npm run check:samples` checks verified TypeScript samples against the build. Release installation samples remain pending until the first release.

## Reading order

1. [Installation](installation.md): build today or prepare for a GitHub release.
2. [Concepts](concepts.md): the API in one page, from loading the module to errors.
3. [Vote selection](vote.md) and the [keystore](keystore.md), for wallets; [ownership proofs](ownership.md) of Solar addresses, for the Legacy Signer and the services that check its proofs.
4. [Rules apps must never get wrong](rules.md): the checklist every app follows.
5. [Devnet](devnet.md): the network to develop against, and its profile.
6. The quickstart for your app type:
   - [Node script](quickstart/node.md)
   - [Vite and React wallet](quickstart/vite-react.md)
   - [Next.js explorer or portal](quickstart/nextjs.md)
   - [Manifest V3 extension](quickstart/mv3-extension.md)
   - [Tauri 2 desktop and mobile](quickstart/tauri.md)
   - [Rust backend (Axum)](quickstart/rust-backend.md)
The [example wallet](../examples/vite-react-wallet/README.md) (Vite and React) puts the pieces together against a devnet: create and restore, a keystore, balance and history, transfers, votes in the four modes with every pick's reasons and a later check, and sign-in. The [Tauri example](../examples/tauri-plugin/README.md) is a Tauri app on the native plugin.

## What version 0.1.0 covers

| Area | 0.1.0 | Later |
|---|---|---|
| Loading in Node, browsers, Next.js, Vite, Tauri webviews and Manifest V3 extensions | Yes | |
| Tauri apps on the native plugin (`@iceroot-network/sdk/tauri` with `tauri-plugin-iceroot`): keys, signing, the keystore and node requests in Rust | Yes, checked on Linux; the plugin builds for Android | macOS and iOS builds, on a Mac |
| Devnet profile with pinned network identity, capabilities, rules and economics | Yes | Profiles for later networks as they are created |
| 24-word recovery phrases, import of 18, 21 or 24 words, hardened derivation | Yes | Post-quantum keys (ML-DSA-65) |
| Import of the devnet's legacy passphrase keys (devnet profiles only) | Yes | Retired with the devnet formats |
| Addresses, amounts in base units | Yes | Bech32m addresses (`ice1...`, `tice1...`), 18 decimals |
| Transfers (1 to 256 recipients, one memo), votes, burns, second key, validator registration, resignation and its revoke | Yes | Names, reward-sharing declarations, assets, swaps, hash time locks, time locks, key rotation, multisig, migration exits |
| Fees resolved from the network, drafts, draft serialization, submission and status | Yes | Finality (`until: "final"`) |
| Node reads: status, accounts, history, blocks, transactions, validators, rounds, fees, supply; watching blocks and accounts by polling, watch-only accounts | Yes | Indexer history and pushed live events |
| Message signing, sign-in challenge format | Yes | Post-quantum message signatures |
| Vote selection library (Diversity, Reliability, Maximum Rewards, Support Newcomers), `check`, manual votes | Yes, on the node's validator list | Windowed figures, declarations and payouts from an indexer |
| Keystore format: a recovery phrase encrypted under a password, and accounts opened straight from it | Yes, in WebAssembly and natively in the Tauri plugin | The post-quantum key seed as a payload |
| Ownership proofs of Solar addresses (version 1, the Legacy Signer's format) | Yes | A separate legacy package once IceRoot's own formats replace today's |

See [Development](development.md) for build, test and release instructions.

## Sample status

Every fenced code block in these pages is preceded by an HTML comment that states its status. On GitHub the comment is hidden; in the Markdown source it reads like this:

<!-- sample: plain -->
```text
<!-- sample: pending; needs: connect, net.build.transfer -->
```

| Status | Meaning |
|---|---|
| `pending` | Uses SDK functions that were not yet built or not yet checked when the page was written. `needs` names them. Verify the sample against the build and change its status to `verified` |
| `later` | Uses a feature of a later release. It shows the intended shape so an app can plan for it; do not implement a stand-in for it |
| `verified` | Checked against the named release, for example `verified 0.1.0` |
| `plain` | Uses no SDK function (a shell command, a format, a configuration line that does not depend on the SDK) |

To list the samples that still need checking, and the SDK names they depend on:

<!-- sample: plain -->
```sh
node scripts/check-docs.mjs            # checks markers and relative links
node scripts/check-docs.mjs --list     # every pending and later sample, with its needs
node scripts/check-docs.mjs --needs    # every SDK name the pages depend on, with the pages
node scripts/check-docs.mjs --extract out/samples   # writes each TypeScript sample to a file for type checking
```

## Conventions

- Amounts are `bigint` base units everywhere. On today's devnet ROOT has 8 decimals: 1 ROOT is `100000000n`.
- Code uses `net` for a connected network (the result of `connect`) and `account` for a key handle.
- Relay URLs include the API base path, `/api` on today's devnet: `http://127.0.0.1:6003/api`, not `http://127.0.0.1:6003`.
- Words follow the IceRoot whitepaper: account, validator, voter, memo, name, asset, finality. Older terms of the reference implementation's API ("delegate", "username", "vendor field") never appear in the SDK; the SDK translates them.
