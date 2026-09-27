# IceRoot SDK documentation

These pages explain how to use the IceRoot SDK for TypeScript and JavaScript, and how to replace the sample data of the five IceRoot apps (explorer, validators portal, desktop wallet, mobile wallet and browser wallet) with SDK calls. They are written so that a developer can wire an app from these pages alone, without guessing.

The SDK is one Rust core with two front ends: this package, which is the core compiled to WebAssembly with a thin TypeScript wrapper, and the Rust crates in [sdk-rust](https://github.com/iceroot-network/sdk-rust), which the explorer and portal backends use natively. Both use the same types and rules, and the records the node API returns have the same fields (snake case in Rust). In Rust the node API client is sans-IO: it builds each request and decodes each answer, and its HTTP transport sends them; the [Rust backend quickstart](quickstart/rust-backend.md) shows the few lines that `connect` does in TypeScript.

## Status of these pages

Every code sample carries a status marker (see [Sample status](#sample-status)). The samples marked `verified 0.1.0` were checked against the build of release 0.1.0: each was type-checked against the package's declarations (the Rust samples compiled against the crates), and the quickstarts are assembled from their samples and run against a local devnet by the package's end-to-end test. `npm run check:samples` type-checks every TypeScript sample marked verified again on each build, so a change to the package that breaks one fails the checks. The samples still marked `pending` install the release itself from its GitHub URL, which exists only once the release is published.

## Reading order

1. [Installation](installation.md): get the package from a GitHub release.
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
7. The integration guide for your app:
   - [Explorer](apps/explorer.md)
   - [Validators portal](apps/validators.md)
   - [Desktop wallet](apps/desktop-wallet.md)
   - [Mobile wallet](apps/mobile-wallet.md)
   - [Browser wallet](apps/browser-wallet.md)

Each integration guide lists what can be wired with release 0.1.0 and what waits for a later release, so that no app builds a temporary replacement it must remove again.

## What release 0.1.0 covers

| Area | 0.1.0 | Later |
|---|---|---|
| Loading in Node, browsers, Next.js, Vite, Tauri webviews and Manifest V3 extensions | Yes | |
| Devnet profile with pinned network identity, capabilities, rules and economics | Yes | Profiles for later networks as they are created |
| 24-word recovery phrases, import of 18, 21 or 24 words, hardened derivation | Yes | Post-quantum keys (ML-DSA-65) |
| Import of the devnet's legacy passphrase keys (devnet profiles only) | Yes | Retired with the devnet formats |
| Addresses, amounts in base units | Yes | Bech32m addresses (`ice1...`, `tice1...`), 18 decimals |
| Transfers (1 to 256 recipients, one memo), votes, burns, second key, validator registration, resignation and its revoke | Yes | Names, reward-sharing declarations, assets, swaps, hash time locks, time locks, key rotation, multisig, migration exits |
| Fees resolved from the network, drafts, draft serialization, submission and status | Yes | Finality (`until: "final"`) |
| Node reads: status, accounts, history, blocks, transactions, validators, rounds, fees, supply; watching blocks and accounts by polling, watch-only accounts | Yes | Indexer history and pushed live events |
| Message signing, sign-in challenge format | Yes | Post-quantum message signatures |
| Vote selection library (Diversity, Reliability, Maximum Rewards, Support Newcomers), `check`, manual votes | Yes, on the node's validator list | Windowed figures, declarations and payouts from an indexer |
| Keystore format: a recovery phrase encrypted under a password | Yes, in WebAssembly | Run natively by the Tauri plugin; the post-quantum key seed as a payload |
| Ownership proofs of Solar addresses (version 1, the Legacy Signer's format) | Yes | A separate legacy package once IceRoot's own formats replace today's |
| Native Tauri plugin (keys and signing in Rust) | | A later release |

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
