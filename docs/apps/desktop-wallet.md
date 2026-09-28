# Integration guide: desktop wallet

The desktop wallet (`iceroot-network/desktop-wallet`) is a Vite, React 19 and Tauri 2 app for Linux and macOS. Today its **Explore demo** reads `public/mock-test-api.json`, and transfers and votes change only that sample in memory. After wiring, a wallet in a profile is a real devnet account: created or imported from a recovery phrase, kept in an encrypted keystore, with balances, history, transfers to 1 to 256 recipients, votes, validator registration and resignation, all through the SDK.

The wallet uses the SDK's native Tauri plugin: it registers `tauri-plugin-iceroot` in `src-tauri` and imports `@iceroot-network/sdk/tauri`. Keys, signing, the keystore's Argon2id and every request to the node run in Rust; the page holds opaque key handles and reaches no node, and its CSP stays as it is.

Read first: [Concepts](../concepts.md), [Rules](../rules.md), [Tauri quickstart](../quickstart/tauri.md). The order of work, file by file, is in [Step by step: the desktop wallet from sample data to the SDK](desktop-wallet-steps.md); the [Tauri example](../../examples/tauri-plugin/README.md) is a working plugin app, and the [example wallet](../../examples/vite-react-wallet/README.md) has every screen (on the WebAssembly entry, whose calls are the same).

## What to wire now and what waits

| Part | Release 0.1.0 | Waits for |
|---|---|---|
| The plugin, and the network connection through it with a pinned devnet identity | Wire now | |
| Watch-only wallets with real address checks | Wire now | |
| Create (24 words) and import (18, 21 or 24 words) | Wire now | |
| Keys kept across restarts in the [keystore](../keystore.md), desktop preset, unlocked with a password | Wire now | |
| Balances, history, validator directory | Wire now | |
| Transfers (1 to 256 recipients, one memo), manual votes and vote withdrawal | Wire now | |
| Vote modes (Diversity, Reliability, Maximum Rewards, Support Newcomers) with reasons | Wire now with the [vote library](../vote.md) (`@iceroot-network/sdk/tauri/vote`); keep the manual editor as the fifth choice | Indexer figures for Reliability, Maximum Rewards and Support Newcomers |
| Validator registration, temporary and permanent resignation, revoke | Wire now (they are previews today) | |
| Second key | Wire now if the product wants it | |
| macOS builds | Build and test on a Mac: the plugin is checked on Linux | |
| Names, swaps, time locks, key rotation, multisig, burn of other assets, asset details, finality, migrations | Hide | The capabilities of later networks |

## The current sample-data layer

| File | Role today |
|---|---|
| `public/mock-test-api.json` | Sample data, schema version 1: `wallets`, `assets`, `transactions`, `validators`, `contacts`, `snapshotAt`, `historyStartsAt`; `network: "testnet"` |
| `src/mockData.ts` | `loadDemoData()` fetches and validates the fixture; types `DemoWallet`, `DemoAsset`, `DemoValidator`, `DemoTransaction`, `DemoData`; `formatDemoAmount` formats a `number` |
| `src/demoSession.ts` | `demoTransfer` (one receipt per recipient, a demo fee of 0.1 ROOT per recipient), `demoVote` (`DEMO_VOTE_FEE = 0.1`), `MAX_TRANSFER_RECIPIENTS = 256`, `MAX_MEMO_BYTES = 255`, `memoBytes`, 18 decimals |
| `src/vote.ts` | `VOTE_MIN_VALIDATORS = 20`, `VOTE_MAX_VALIDATORS = 53`, `VOTE_MAX_SHARE = 500`, `VOTE_TOTAL = 10_000`; `voteProblem`, `evenVote`, `sameVote`, `shareSummary`; `VoteEntry = { validatorId, basisPoints }` |
| `src/storage.ts` | Profiles in the app data directory (unencrypted): `WalletReference = { kind: "workspace" \| "watch", address }`, contacts, `network: "mainnet" \| "testnet"`; `validAddressReference` accepts any string without spaces |
| `src/App.tsx` | `openDemo()` loads the fixture into a demo profile; `simulateTransfer` and `simulateVote` call the demo session |
| `src/SendFlow.tsx`, `src/DemoPages.tsx`, `src/WalletFlows.tsx` | The send flow, the demo pages (overview, activity, assets, governance) and the wallet setup (create, watch, import placeholder) |
| `src-tauri/tauri.conf.json`, `src-tauri/capabilities/main.json` | The CSP (`script-src 'self'`, `connect-src 'self' ipc: http://ipc.localhost`) and the window capabilities |

## Mapping: sample field to SDK call

| Sample | SDK | Notes |
|---|---|---|
| `wallets[].address` (`DEMO-...`) | `account.address` from a phrase, or `Address.parse(text, net)` for a watch-only wallet | Replace `validAddressReference` with `Address.check(text, net)` for wallets and contacts |
| `wallets[].balance`, `assets[]` holdings | `net.accounts.get(address).balances` | `bigint` base units; today only ROOT exists |
| `wallets[].vote` (`validatorId`, `basisPoints`) | `net.accounts.get(address).vote` (`validator`, `basisPoints`) | `validator` is the validator's name |
| `assets[]` | `net.token` | One asset on today's devnet; `id: "root"` becomes `net.token.assetId` |
| `transactions[]` | `net.history.forAccount(address)` | `TxRecord`; one transfer has one id however many recipients it pays |
| `validators[]`: `name`, `rank`, `status`, `votingBalance`, `validatedBlocks`, `address` | `(await net.validators.list()).items`: `name`, `rank`, `status`, `voteWeight`, `production.produced`, `address` | `uptime` comes from `production` (lifetime counters today). `tagline` and `color` are not chain data: take the tagline from the validators portal later, or omit it |
| `contacts[]` | The profile's own storage | Check each address with `Address.check` against the connected network |
| `snapshotAt` | The latest block's time, `net.blocks.latest()` | Never the device clock |
| `historyStartsAt` | None | History is paged from the node |
| Demo fees (`DEMO_VOTE_FEE`, 0.1 ROOT per recipient) | `draft.fee` | |
| 18 decimals (`DECIMALS`, `ONE_ROOT`) | `net.token.decimals` | 8 on today's devnet |
| `MAX_TRANSFER_RECIPIENTS`, `MAX_MEMO_BYTES` | `net.rules.transfer.maxRecipients`, `net.rules.memo.maxBytes` | |
| `VOTE_MIN_VALIDATORS`, `VOTE_MAX_VALIDATORS`, `VOTE_MAX_SHARE`, `VOTE_TOTAL` | `net.rules.vote` | See [votes](#votes) |
| Profile `network: "mainnet" \| "testnet"` | The profile the app connects with | Only a devnet profile exists in 0.1.0 |

## Wiring steps

### 1. Install and configure

1. Install the SDK tarball ([Installation](../installation.md)). The Tauri entry loads no WebAssembly, so Vite needs no `optimizeDeps` setting for it; keep `build.target: "safari14"`.
2. Add `tauri-plugin-iceroot` to `src-tauri/Cargo.toml`, register `tauri_plugin_iceroot::init()` in `src-tauri/src/lib.rs`, and grant `iceroot:default` and the devnet relays in `src-tauri/capabilities/main.json` ([Tauri quickstart, steps 1 and 2](../quickstart/tauri.md#1-add-the-plugin)).
3. Keep the CSP as it is (`script-src 'self'`, `connect-src 'self' ipc: http://ipc.localhost`): the page loads no WebAssembly and reaches no node. No HTTP plugin is needed.
4. The browser preview (`npm run dev` in a normal browser) has no plugin: `init()` rejects with `SdkNotInitialized` there. Run the wallet with `tauri dev`, and keep the browser preview for the labelled Explore demo only.

### 2. The network

Replace the profile's `network: "mainnet" | "testnet"` preference with the network the SDK connects to. In 0.1.0 that is a devnet, with the relay URL and the pinned identity stored in the profile:

<!-- sample: verified 0.1.0 -->
```ts
// src/network.ts
import { init, connect, profiles, IceRootError, type Network } from "@iceroot-network/sdk/tauri";

export type NetworkSetting = { kind: "devnet"; relay: string; nethash?: string };

export async function openNetwork(setting: NetworkSetting): Promise<{ net: Network; nethash: string }> {
  await init();   // rejects with SdkNotInitialized outside the Tauri app
  const net = await connect(profiles.devnet({ relays: [setting.relay], nethash: setting.nethash }));
  return { net, nethash: net.chain.nethash };   // save nethash in the profile on first contact
}

export function isNetworkChanged(error: unknown): boolean {
  return error instanceof IceRootError && error.code === "NetworkMismatch";
}
```

- The relay must be allowed by the capability of step 1; a relay it does not name is refused with `InvalidProfile` (`details.reason: "not-allowed"`). A settings screen that lets the holder type a relay needs a matching `allow` entry (for example `http://127.0.0.1:*/api` for local devnets).
- `src-tauri/src/lib.rs` validates the stored state strictly (`Network::Mainnet | Testnet`). Extend the Rust types and the TypeScript `UserProfile` together with the new network setting, and keep the migration of older state files.
- Show "Testnet" and "Mainnet" as not yet available. There is no SDK profile for them until their geneses exist.
- On `NetworkMismatch`, tell the holder the devnet changed and ask before pinning the new identity.

### 3. Wallets: watch, create, import

- **Watch.** `WalletFlows.tsx` saves an address. Check it with `await Address.check(text, net)` and store `(await Address.parse(text, net)).toString()`. Drop "Address formats are not verified in this preview."
- **Create.** Generate `await Mnemonic.generate()` (24 words), show it for backup, confirm a few words, then ask for a password and encrypt the phrase into a keystore with the desktop preset. Store the keystore's text form with the wallet in the profile (it is encrypted; the password is never stored), and the address in the `WalletReference`. Further addresses of the same phrase use `index: 1, 2, ...`.
- **Import.** Replace "Import is coming soon." with phrase entry: `await Mnemonic.check(text)` for feedback (18, 21 or 24 words; fewer give `PhraseTooShort`), then the same keystore as for a new wallet.
- **Unlock.** Open the wallet's account with `net.keys.fromKeystore(keystore, password, { account: 0, index })`: the plugin decrypts the keystore and derives the key, and the phrase never enters the page. `release()` the account on lock, on window close and after a period of inactivity; the plugin also wipes every key the page opened when the page reloads or the window closes.

<!-- sample: verified 0.1.0 -->
```ts
// src/keys.ts: keystores in the profile, keys in the plugin
import { Address, Mnemonic, type Account, type Network } from "@iceroot-network/sdk/tauri";
import { armor, encrypt, isWeakerThan, inspect, reencrypt, PRESETS } from "@iceroot-network/sdk/tauri/keystore";

const open = new Map<string, Account>();

export function newPhrase(): Promise<string> {
  return Mnemonic.generate();
}

/** The keystore text to store with the wallet: the phrase, encrypted in the plugin with the desktop preset. */
export async function keep(phrase: string, password: string): Promise<string> {
  const check = await Mnemonic.check(phrase);
  if (!check.ok) throw new Error(check.reason === "too-short" ? "Use your 18, 21 or 24 word recovery phrase." : "This recovery phrase is not valid.");
  return armor(await encrypt(phrase.trim(), password, "desktop"));
}

/** Opens a wallet's account; a keystore written with weaker parameters is moved to the current preset. */
export async function unlock(net: Network, walletId: string, keystore: string, password: string, index = 0) {
  await open.get(walletId)?.release();
  const account = await net.keys.fromKeystore(keystore, password, { account: 0, index });
  open.set(walletId, account);
  const upgraded = (await isWeakerThan(await inspect(keystore), PRESETS.desktop))
    ? await armor(await reencrypt(keystore, password, "desktop"))
    : undefined;
  return { account, upgraded };   // store `upgraded` in place of the old keystore when it is set
}

export async function lockAll(): Promise<void> {
  for (const account of open.values()) await account.release();
  open.clear();
}

export async function watchAddress(net: Network, text: string): Promise<string> {
  const result = await Address.check(text.trim(), net);
  if (!result.ok) throw new Error(`Check the address (${result.reason}).`);
  return (await Address.parse(text.trim(), net)).toString();
}
```

- A wrong password is `WrongPasswordOrCorrupt` (from `@iceroot-network/sdk/tauri/keystore`); say "Wrong password" and nothing more.
- `storage.ts` writes the profile as unencrypted JSON: only the keystore's text goes there, never a phrase, key or password.
- The phrase crosses the IPC twice, when it is shown and when it is encrypted. Show it once, clear the text fields afterwards, and never read it back with `decrypt` except for a backup the holder asks for.

### 4. Balances, history and validators

- Replace `loadDemoData` for real wallets with reads: `net.accounts.get(address)` for balances and the current vote, `net.history.forAccount(address, { page, limit })` for activity, `net.validators.list()` for the directory.
- Replace `formatDemoAmount(number)` with `await Amount.format(units, net.token.decimals, { grouping: true })`, formatted when the data is loaded rather than during a render. No amount is a `number` any more.
- Refresh on new blocks (`net.watch` or a timer of one block time), not per screen render.
- Keep **Explore demo** only if it stays fully separate: its screens read the fixture, never the network, and say "Demo". Real wallets never fall back to it.

### 5. Transfers

`SendFlow.tsx` already has Details, Review and Result steps. Map them to build, review and sign:

<!-- sample: verified 0.1.0 -->
```ts
// src/transfer.ts
import { Address, Amount, type Account, type Draft, type Network } from "@iceroot-network/sdk/tauri";

export type TransferEntry = { recipient: string; amount: string };

/** Details step: one transaction for all recipients, with one memo. */
export async function prepareTransfer(net: Network, from: string, entries: TransferEntry[], memo: string): Promise<Draft> {
  const to = [];
  for (const entry of entries) {
    to.push({
      address: await Address.parse(entry.recipient.trim(), net),
      amount: await Amount.parse(entry.amount.trim(), net.token.decimals),
    });
  }
  return net.build.transfer({ from, to, memo: memo.trim() });
}

/** Result step: the plugin signs what the Review step showed; submit, and follow it to a block. */
export async function sendTransfer(net: Network, draft: Draft, account: Account) {
  const signed = await draft.sign(account);
  const result = await net.submit(signed);
  if (result.status !== "accepted") return { state: "rejected" as const, reason: result.reason, id: signed.id };
  const status = await net.transactions.wait(signed.id, { until: "confirmed" });
  if (status.state === "dropped") return { state: "dropped" as const, id: signed.id };
  return { state: status.state, id: signed.id, confirmations: status.confirmations };
}
```

- `from` may be the account's address once the account has sent a transaction, since the node then knows its public key. A new account has not, and the builder refuses its address with `InvalidArgument`: pass its `Account` or its public key instead.
- The Review step renders `draft.summary` and `draft.fee`. The demo's "one receipt per recipient" goes away: a transfer to 12 recipients is one transaction with one id and one fee.
- The form's limits come from `net.rules.transfer.maxRecipients` and `net.rules.memo.maxBytes`; keep counting memo bytes with `TextEncoder`, as `memoBytes` does.
- The amount field accepts at most `net.token.decimals` fraction digits; `Amount.parse` refuses more.
- A refusal with reason `nonce` means the account sent another transaction since the draft was built: build again and show the new review.
- The Result step says "Confirmed in block N", never "final".

### Votes

The governance page's editor splits a vote evenly across the chosen validators. Wire it to `net.build.vote`:

<!-- sample: verified 0.1.0 -->
```ts
// src/votes.ts
import type { Network, VoteEntry } from "@iceroot-network/sdk/tauri";

/** Whole basis points summing to the network's total; the first names take any remainder. */
export function evenVote(net: Network, names: string[]): VoteEntry[] {
  const total = net.rules.vote.totalBasisPoints;
  const share = Math.floor(total / names.length);
  const remainder = total - share * names.length;
  return names.map((validator, index) => ({ validator, basisPoints: share + (index < remainder ? 1 : 0) }));
}

export function voteProblem(net: Network, entries: VoteEntry[]): string | null {
  const rules = net.rules.vote;
  if (entries.length === 0) return null;   // an empty vote withdraws
  if (entries.length < rules.minEntries) return `Choose at least ${rules.minEntries} validators.`;
  if (entries.length > rules.maxEntries) return `A vote names at most ${rules.maxEntries} validators.`;
  if (entries.some((entry) => entry.basisPoints > rules.maxBasisPointsPerEntry)) {
    return `No validator can receive more than ${rules.maxBasisPointsPerEntry / 100}% of your vote.`;
  }
  return null;
}

export function prepareVote(net: Network, from: string, entries: VoteEntry[]) {
  return net.build.vote({ from, entries });   // throws InvalidVote with details if the network refuses the entries
}
```

- `validatorId` becomes the validator's `name` everywhere (`VoteEntry`, the fixture types, `sameVote`).
- The wallet may keep proposing 20 validators at 500 basis points each as its default, which is valid on today's devnet and from the IceRoot genesis; the limits it enforces come from `net.rules.vote`.
- A validator account cannot vote from the IceRoot genesis. Check `(await net.accounts.get(address)).validatorName` and hide the vote editor for validator accounts, and let the builder enforce the rule.
- `evenVote` is replaced by the [vote library](../vote.md)'s `split`, and the modes come from its `select` over `VoteSnapshot.fromNode(net)`, with each pick's reasons on the review screen and `check` of the saved selection when the wallet opens, all from `@iceroot-network/sdk/tauri/vote` and awaited. Do not implement the modes in the app.

### 6. Validator registration and resignation

Replace the previews with `net.build.registerValidator({ from, name })` and `net.build.resignValidator({ from, resignation })` (`"temporary"`, `"permanent"` or `"revoke"`). The registration surcharge is part of `draft.fee`: 75 ROOT on today's devnet, 250 ROOT from the IceRoot genesis. Show `draft.fee`, never either number. Check the name with the builder's `InvalidName` error, not with a local regular expression.

### 7. Capabilities

Gate each later screen on `net.capabilities.has(...)`: names (`names`), swaps and time locks (`swaps`, `htlc`, `time-locks`), key rotation and multisig (`key-rotation`, `multisig`), assets other than ROOT (`assets`), finality (`finality`) and migrations (`migration-exit`). With 0.1.0 all of them are false on the devnet; the screens stay hidden, not disabled with an error.

## Rules that apply to the desktop wallet

- No constants for fees, decimals, recipients, memo size or vote limits ([rule 1](../rules.md)).
- Amounts are `bigint` base units; the demo's `number` amounts go away ([rule 2](../rules.md)).
- Addresses are checked against the connected network ([rule 4](../rules.md)).
- "Confirmed", never "final", on today's devnet ([rule 5](../rules.md)).
- No phrase, key or password in the profile state file, `localStorage` or any unencrypted file; phrases are kept only as keystores, and keys only in the plugin ([rule 12](../rules.md)).
- The review screen shows the draft ([rule 15](../rules.md)); votes are never recast automatically ([rule 7](../rules.md)).

## Tests to add

- The app under `tauri-driver` against a local devnet, as the SDK's own Tauri check does (`test/contexts/tauri-plugin` in this repository): create a wallet, fund it from a devnet test account in a setup script, send a transfer, see it confirmed, lock, reload and unlock with the password.
- Unit tests of the pages and the wallet's own logic with the SDK module replaced by a stub: the plugin makes the requests, so a stub transport does not reach it. The recorded devnet answers of sdk-rust's node API client fixtures make realistic stub data.
- A test that no phrase or password reaches the profile state file or `localStorage`, and that a relay the capability does not allow is refused.
