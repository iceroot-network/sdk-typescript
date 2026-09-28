# Integration guide: desktop wallet

The desktop wallet (`iceroot-network/desktop-wallet`) is a Vite, React 19 and Tauri 2 app for Linux and macOS. Today its **Explore demo** reads `public/mock-test-api.json`, and transfers and votes change only that sample in memory. After wiring, a wallet in a profile is a real devnet account: created or imported from a recovery phrase, kept in an encrypted keystore, with balances, history, transfers to 1 to 256 recipients, votes, validator registration and resignation, all through the SDK.

The wallet uses the SDK's native Tauri plugin: it registers `tauri-plugin-iceroot` in `src-tauri` and imports `@iceroot-network/sdk/tauri`. Keys, signing, the keystore's Argon2id and every request to the node run in Rust; the page holds opaque key handles and reaches no node, and its CSP stays as it is.

The wallet in `iceroot-network/desktop-wallet` is wired to this SDK and is the worked example for the browser and mobile wallets too. Its modules are named in this guide where they matter: `src/session.ts` (build, review, sign, submit), `src/keys.ts` (opening a key and checking its address), `src/walletData.ts` (reads and `safeText`), `src/network.ts` (the connection), `src/vote.ts` and `src/voteModes.ts` (votes), and `src/lifecycle.ts` and `src/storage.ts` (profile state, locking and refresh). Until the native plugin is wired there, that wallet runs the WebAssembly entry with the Tauri HTTP plugin as transport ([step 2](#2-the-network) says what differs). The calls are the same, and the functions here are the ones it has, with the plugin's awaits added.

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
3. Keep the CSP as it is (`script-src 'self'`, `connect-src 'self' ipc: http://ipc.localhost`): the page loads no WebAssembly and reaches no node. No HTTP plugin is needed. (On the interim WebAssembly path, `script-src` also needs `'wasm-unsafe-eval'`, and node requests go through the Tauri HTTP plugin, whose capability names the relay.)
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
- **The interim path.** On the WebAssembly entry, `init()` takes the `.wasm` file's URL and `connect` takes a transport. Inside Tauri the transport is the HTTP plugin's `fetch`, so the request leaves from Rust: `connect(profile, isTauri() ? { transport: tauriFetch } : {})`, with `import { fetch as tauriFetch } from "@tauri-apps/plugin-http"` and `import { isTauri } from "@tauri-apps/api/core"`. Outside Tauri, pass nothing: the default transport is the page's own `fetch`. Never pass `globalThis.fetch` itself. The SDK calls the transport as a method, and a browser's `fetch` refuses another `this` with `TypeError: Illegal invocation`. Use an arrow such as `(input, init) => fetch(input, init)` if you must name it. `src/network.ts` of the reference wallet is this, and [Concepts](../concepts.md#networks-profiles-and-connect) has the rule. The native plugin needs no transport at all.
- **Headers.** `connect` accepts `headers` on both entries, for a hosted endpoint that needs a token ([devnet](../devnet.md#the-hosted-devnet-endpoint)). A name must be a valid HTTP header name and a value must be printable ASCII, so trim what the holder pasted. The error names the header and never shows the value. The local relay of a desktop wallet needs none.

### 3. Wallets: watch, create, import

- **Watch.** `WalletFlows.tsx` saves an address. Check it with `await Address.check(text, net)` and store `(await Address.parse(text, net)).toString()`. Drop "Address formats are not verified in this preview."
- **Create.** Generate `await Mnemonic.generate()` (24 words), show it for backup, confirm a few words, then ask for a password and encrypt the phrase into a keystore with the desktop preset. Store the keystore's text form with the wallet in the profile (it is encrypted; the password is never stored), and the address and the public key (`account.publicKey`) in the `WalletReference`. The public key lets the wallet build drafts with no key open ([step 5](#5-transfers)). Further addresses of the same phrase use `index: 1, 2, ...`.
- **Import.** Replace "Import is coming soon." with phrase entry: `await Mnemonic.check(text)` for feedback (18, 21 or 24 words; fewer give `PhraseTooShort`), then the same keystore as for a new wallet.
- **Unlock.** Open the wallet's account with `net.keys.fromKeystore(keystore, password, { account: 0, index })`: the plugin decrypts the keystore and derives the key, and the phrase never enters the page. Compare the account's address with the saved one every time, and refuse a key of another address. A wrong index, another wallet's keystore or a changed scheme each give a valid key of an address the holder never saw ([rule 17](../rules.md)). Opening a key needs a profile only, not a network, so unlock works with no connection. The key is opened for the signing, after the review, not when the screen opens. `release()` the account on lock, on window close and after a period of inactivity; the plugin also wipes every key the page opened when the page reloads or the window closes.

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

/** Opens a wallet's account, only if it is the saved address; a keystore written with weaker parameters is moved to the current preset. */
export async function unlock(net: Network, walletId: string, keystore: string, password: string, address: string, index = 0) {
  const account = await net.keys.fromKeystore(keystore, password, { account: 0, index });
  if (account.address !== address) {   // the address the holder saw and saved
    await account.release();
    throw new Error("This keystore belongs to another wallet.");
  }
  await open.get(walletId)?.release();   // replaced only when the check passed
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
- Text that comes from the chain is not safe to show as it is: a memo, a validator's name, an address in a record. A control character or a bidirectional formatting character reorders or splits what the holder reads, for example a memo with U+202E that shows an address backwards. Show it through `safeText` in `src/walletData.ts`, which writes those characters as `\uXXXX` and a backslash as `\\` ([rule 16](../rules.md)). The lines of `draft.summary` are escaped by the SDK already.
- Refresh on new blocks (`net.watch` or a timer of one block time), not per screen render.
- Keep **Explore demo** only if it stays fully separate: its screens read the fixture, never the network, and say "Demo". Real wallets never fall back to it.

### 5. Transfers

`SendFlow.tsx` already has Details, Review and Result steps. Map them to build, review and sign:

<!-- sample: verified 0.1.0 -->
```ts
// src/session.ts
import { Address, Amount, type Account, type Draft, type Network } from "@iceroot-network/sdk/tauri";

export type TransferEntry = { recipient: string; amount: string };

/** Who a draft is from: an open account, or a public key or an address as text. Prefer the text. */
export type Sender = Account | string;

/**
 * The sender to build with for a saved wallet, with no key: its public key when the wallet kept
 * one, else its address. The kept public key must give the kept address.
 */
export async function senderOf(net: Network, wallet: { address: string; publicKey?: string }): Promise<string> {
  if (wallet.publicKey === undefined) return wallet.address;
  if ((await Address.fromPublicKey(wallet.publicKey, net)).toString() !== wallet.address) {
    throw new Error("This wallet's public key does not match its address. Remove the wallet and import it again.");
  }
  return wallet.publicKey;
}

/** Details step: one transaction for all recipients, with one memo. No key is open. */
export async function prepareTransfer(net: Network, from: Sender, entries: TransferEntry[], memo: string): Promise<Draft> {
  const to = [];
  for (const entry of entries) {
    to.push({
      address: await Address.parse(entry.recipient.trim(), net),
      amount: await Amount.parse(entry.amount.trim(), net.token.decimals),
    });
  }
  return net.build.transfer({ from, to, memo: memo.trim() });
}

/** Result step: the key is opened now, after the Review step. The plugin signs what that step showed; submit, and follow it to a block. */
export async function sendTransfer(net: Network, draft: Draft, account: Account) {
  try {
    const signed = await draft.sign(account);
    const result = await net.submit(signed);
    if (result.status !== "accepted") return { state: "rejected" as const, reason: result.reason, id: signed.id };
    const status = await net.transactions.wait(signed.id, { until: "confirmed" });
    if (status.state === "dropped") return { state: "dropped" as const, id: signed.id };
    return { state: status.state, id: signed.id, confirmations: status.confirmations };
  } finally {
    await account.release();   // a key is held only as long as it is needed
  }
}
```

- **Build without a key.** `from` is the sender's public key or address, or an open `Account`. The public key works for every account, including one that has never sent a transaction, so the wallet keeps it with the address ([step 3](#3-wallets-watch-create-import)) and builds with `await senderOf(net, wallet)`. An address works once the account has sent a transaction, since the node then learns its public key. For a new account the builder refuses an address with `InvalidArgument` ("the node does not know this address's public key until the account sends a transaction"). A watch-only wallet has no public key, so a quote for a new account needs the phrase.
- **Sign after the review.** The Details and Review steps hold no key. The holder confirms, the wallet opens the key with `unlock` (which checks the address), signs the draft the Review step showed, and releases the key. `src/session.ts` of the reference wallet is this, with `send`, `prepareVote`, `prepareRegistration` and `prepareResignation`.
- **Two contexts.** A wallet whose network code and key live in different contexts, such as a browser extension, does not pass a `Draft` object across. It passes `draft.serialize()`, the signing context restores it with `Draft.deserialize(bytes, profile)` (which recomputes the summary and refuses another network), shows that summary, and signs only if the bytes still give the summary the holder saw. See `reviewDraft` and `signDraft` in the same file, and the [browser wallet guide](browser-wallet.md#7-transfers-and-votes).
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
import type { Sender } from "./session";

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

/** Builds with no key, from the sender's public key or address (`senderOf` in src/session.ts). */
export function prepareVote(net: Network, from: Sender, entries: VoteEntry[]) {
  return net.build.vote({ from, entries });   // throws InvalidVote with details if the network refuses the entries
}
```

- `validatorId` becomes the validator's `name` everywhere (`VoteEntry`, the fixture types, `sameVote`).
- The wallet may keep proposing 20 validators at 500 basis points each as its default, which is valid on today's devnet and from the IceRoot genesis; the limits it enforces come from `net.rules.vote`.
- A validator account cannot vote from the IceRoot genesis. Check `(await net.accounts.get(address)).validatorName` and hide the vote editor for validator accounts, and let the builder enforce the rule.
- `evenVote` is replaced by the [vote library](../vote.md)'s `split`, and the modes come from its `select` over `VoteSnapshot.fromNode(net)`, with each pick's reasons on the review screen and `check` of the saved selection when the wallet opens, all from `@iceroot-network/sdk/tauri/vote` and awaited. Do not implement the modes in the app.
- **The snapshot is slow.** `VoteSnapshot.fromNode(net)` makes one request for each validator that has forged, on top of the list and the registrations, and a node allows about 100 requests per minute per client. With the other reads of the page the SDK waits for budget, so on a devnet the read can take a minute or more. Read it once per visit of the vote page, show that it is going on, and reuse it for every redraw. `src/voteModes.ts` does this.
- **A new devnet accepts no votes at first.** The snapshot leaves out validators whose node the node has not seen running, and the node refuses a vote that names one (node code `ERR_OFFLINE`). On a new devnet that is every validator until the first round has passed ([devnet](../devnet.md#a-new-devnet-and-its-first-round)). Show the node's message, offer to read again later, and do not treat it as a fault of the wallet. A test that must vote early waits until at least 20 validators in `net.validators.list()` have a `version`, and gives up after twice the seats in blocks. `isOfflineValidator` in `src/session.ts` recognises the refusal.
- Validator names and reason texts go through `safeText` before they are shown.

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
- Drafts are built with no key open, and the key is opened after the review and released after the signing ([rule 15](../rules.md)).
- Chain text (memos, names, addresses in records) is shown through `safeText` ([rule 16](../rules.md)).
- A reopened wallet's key is checked against the saved address ([rule 17](../rules.md)).

## Tests to add

- The app under `tauri-driver` against a local devnet, as the SDK's own Tauri check does (`test/contexts/tauri-plugin` in this repository): create a wallet, fund it from a devnet test account in a setup script, send a transfer, see it confirmed, lock, reload and unlock with the password.
- Unit tests of the pages and the wallet's own logic with the SDK module replaced by a stub: the plugin makes the requests, so a stub transport does not reach it. The recorded devnet answers of sdk-rust's node API client fixtures make realistic stub data.
- A test that a draft is built from the saved public key or address with no key open, that a key of another address is refused on unlock, and that a memo with U+202E or a line break is shown escaped (`session.test.ts`, `keys.test.ts` and `walletData.test.ts` in the reference wallet do this).
- A test that no phrase or password reaches the profile state file or `localStorage`, and that a relay the capability does not allow is refused.
