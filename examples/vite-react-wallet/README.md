# Example wallet: Vite and React

A small wallet for today's devnet, built on the IceRoot SDK. It is the worked example of the [vote library](../../docs/vote.md) and the [keystore](../../docs/keystore.md), and of the [step-by-step guide](../../docs/apps/desktop-wallet-steps.md) that moves the desktop wallet from sample data to the SDK. Devnet tokens have no value.

What it does, and where:

| Screen | What it shows | Files |
|---|---|---|
| Create | A new 24-word recovery phrase, confirmed by two of its words | `src/Setup.tsx` |
| Restore | An 18-, 21- or 24-word phrase; shorter phrases are refused | `src/Setup.tsx` |
| Keep and unlock | The phrase's entropy encrypted under the holder's password with the keystore's `web` preset, kept in the browser; unlocking opens the account straight from it, so the phrase never reaches JavaScript, and a wrong password is refused | `src/Setup.tsx`, `src/Unlock.tsx`, `src/storage.ts` |
| Overview | The balance, the current vote and the history | `src/Overview.tsx` |
| Send | One transaction to one or more recipients with a memo, through a review screen that shows exactly what is signed | `src/Send.tsx`, `src/submit.ts` |
| Vote | A selection in any of the four modes (Diversity, Reliability, Maximum Rewards, Support Newcomers), a review screen with every pick's reasons and the notice of a mode that topped up from Diversity, "Draw again", the vote signed as reviewed, and a check of the kept selection that reports picks that no longer meet their criteria, such as a validator that resigned | `src/Vote.tsx` |
| Sign in | A website's sign-in message checked for the website's origin, this account, the network and the times, then signed | `src/SignIn.tsx` |

The key lives in WebAssembly memory while the wallet is unlocked and is wiped on lock. The browser keeps only the keystore, the account's address, the network's pinned identity and the last vote selection. A wallet app keeps its keystore where its platform keeps secrets best; the desktop and mobile wallets will run the same keystore format natively with the Tauri plugin.

Two habits to copy. A draft is built from the account's public key, so building needs no open key, and the key is used only when the holder confirms. Text that comes from the chain, such as a memo or a validator's name, goes through `safeText` in `src/format.ts` before it is shown.

## Run it

You need Node.js 22 or later and a devnet (see [Devnet](../../docs/devnet.md)); the wallet connects to `VITE_ICEROOT_RELAY`, by default `http://127.0.0.1:6003/api`.

In this repository, after `npm install` and `npm run build` at its root:

```sh
VITE_ICEROOT_RELAY=http://127.0.0.1:6003/api npm run example:dev     # installs the built package into the example and starts Vite
VITE_ICEROOT_RELAY=http://127.0.0.1:6003/api npm run example:build   # type-checks and builds it into examples/vite-react-wallet/dist
```

As a project of its own, copy this directory, point the `@iceroot-network/sdk` dependency of `package.json` at the release tarball (see [Installation](../../docs/installation.md)), then `npm install` and `npm run dev`.

The production build sets the page policy `script-src 'self' 'wasm-unsafe-eval'` and allows connections to the page's own origin and the relay only (`vite.config.ts`). Vite's pre-bundling is turned off for the SDK, which would separate its JavaScript from its `.wasm` file.

To try a transfer or a vote, restore a devnet account that holds some ROOT, or fund the wallet's address from one: the [Node quickstart](../../docs/quickstart/node.md) sends from a genesis wallet of the devnet.

## Tested

`test/e2e/wallet.e2e.ts` runs the production build in Chromium against a fresh local devnet (`npm run test:e2e -- --only wallet`): it creates a wallet and checks that only the keystore is kept, reloads and unlocks it, refuses a wrong password, restores an 18-word phrase and refuses a 12-word one, sends to two recipients, votes in each of the four modes and compares the vote on chain with the review screen (a validator registered without a node, ranked inside Diversity's pool, is never picked, since a node refuses a vote naming it), has a validator of the vote resign and sees the check flag it, and signs in to a website after refusing a message made for another one.
