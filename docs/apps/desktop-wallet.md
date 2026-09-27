# Integration guide: desktop wallet

The desktop wallet (`iceroot-network/desktop-wallet`) is a Vite, React 19 and Tauri 2 app for Linux and macOS. Today its **Explore demo** reads `public/mock-test-api.json`, and transfers and votes change only that sample in memory. After wiring, a wallet in a profile is a real devnet account: balances, history, transfers to 1 to 256 recipients, votes, validator registration and resignation, all through the SDK.

Read first: [Concepts](../concepts.md), [Rules](../rules.md), [Tauri quickstart](../quickstart/tauri.md), [Vite and React quickstart](../quickstart/vite-react.md).

## What to wire now and what waits

| Part | Release 0.1.0 | Waits for |
|---|---|---|
| Network connection through Rust (HTTP plugin transport), pinned devnet identity | Wire now | |
| Watch-only wallets with real address checks | Wire now | |
| Create (24 words) and import (18, 21 or 24 words); keys held for the session only | Wire now | |
| Keys kept across restarts (encrypted keystore) | Do not build a vault | The native plugin and keystore release |
| Balances, history, validator directory | Wire now | |
| Transfers (1 to 256 recipients, one memo), manual votes and vote withdrawal | Wire now | |
| Vote modes (Diversity, Reliability, Maximum Rewards, Support Newcomers) with reasons | Keep the manual editor | The vote library release |
| Validator registration, temporary and permanent resignation, revoke | Wire now (they are previews today) | |
| Second key | Wire now if the product wants it | |
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
| `validators[]`: `name`, `rank`, `status`, `votingBalance`, `validatedBlocks`, `address` | `net.validators.list()`: `name`, `rank`, `status`, `voteWeight`, `production.forged`, `address` | `uptime` comes from `production` (lifetime counters today). `tagline` and `color` are not chain data: take the tagline from the validators portal later, or omit it |
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

1. Install the SDK tarball and exclude it from Vite's `optimizeDeps` ([Vite quickstart](../quickstart/vite-react.md#2-configure-vite)). Keep `build.target: "safari14"`, and check the build on the oldest supported macOS (see the WebKit note in the [Tauri quickstart](../quickstart/tauri.md#2-allow-webassembly-in-the-webviews-csp)).
2. Add `'wasm-unsafe-eval'` to `script-src` in `csp` and `devCsp` of `src-tauri/tauri.conf.json`.
3. Add the Tauri HTTP plugin, register it in `src-tauri/src/lib.rs`, and allow the devnet URLs in `src-tauri/capabilities/main.json` ([Tauri quickstart, step 3](../quickstart/tauri.md#3-send-node-requests-through-rust)). With the plugin as transport, `connect-src` needs no node origin.

### 2. The network

Replace the profile's `network: "mainnet" | "testnet"` preference with the network the SDK connects to. In 0.1.0 that is a devnet, with the relay URL and the pinned identity stored in the profile:

<!-- sample: pending; needs: init, connect, profiles.devnet, transport-option, tauri-http-transport, net.profile, IceRootError -->
```ts
// src/network.ts
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "@tauri-apps/api/core";
import { init, connect, profiles, IceRootError, type Network } from "@iceroot-network/sdk";

export type NetworkSetting = { kind: "devnet"; relay: string; nethash?: string };

export async function openNetwork(setting: NetworkSetting): Promise<{ net: Network; nethash: string }> {
  await init();
  const net = await connect(
    profiles.devnet({ relays: [setting.relay], nethash: setting.nethash }),
    { transport: isTauri() ? tauriFetch : globalThis.fetch },
  );
  return { net, nethash: net.profile.chain.nethash };   // save nethash in the profile on first contact
}

export function isNetworkChanged(error: unknown): boolean {
  return error instanceof IceRootError && error.code === "NetworkMismatch";
}
```

- `src-tauri/src/lib.rs` validates the stored state strictly (`Network::Mainnet | Testnet`). Extend the Rust types and the TypeScript `UserProfile` together with the new network setting, and keep the migration of older state files.
- Show "Testnet" and "Mainnet" as not yet available. There is no SDK profile for them until their geneses exist.
- On `NetworkMismatch`, tell the holder the devnet changed and ask before pinning the new identity.

### 3. Wallets: watch, create, import

- **Watch.** `WalletFlows.tsx` saves an address. Check it with `Address.check(text, net)` and store `Address.parse(text, net).toString()`. Drop "Address formats are not verified in this preview."
- **Create.** Generate `Mnemonic.generate()` (24 words), show it for backup, confirm a few words, then derive `net.keys.fromPhrase(phrase, { account: 0, index: 0 })` and store the address in the `WalletReference`. Further addresses of the same phrase use `index: 1, 2, ...`.
- **Import.** Replace "Import is coming soon." with phrase entry: `Mnemonic.check(text)` for feedback (18, 21 or 24 words; fewer give `PhraseTooShort`).
- **Where the key lives.** Release 0.1.0 has no keystore format, and `storage.ts` writes unencrypted JSON. Never put a phrase or key into it. Hold the key handle in memory for the session: when the holder signs, ask for the phrase if no handle is open, and `release()` handles on lock, on window close and after a period of inactivity. Do not design a desktop key vault now; the keystore arrives with the native plugin, and the wallet adopts it then.

<!-- sample: pending; needs: Mnemonic.generate, Mnemonic.check, net.keys.fromPhrase, net.keys.watch, Address.check, Address.parse, account.release, Account -->
```ts
// src/keys.ts: session-only key handles, one per wallet id
import { Address, Mnemonic, type Account, type Network } from "@iceroot-network/sdk";

const open = new Map<string, Account>();

export function newPhrase(): string {
  return Mnemonic.generate();
}

export function unlock(net: Network, walletId: string, phrase: string, index = 0): Account {
  const check = Mnemonic.check(phrase);
  if (!check.ok) throw new Error(check.error === "too-short" ? "Use your 18, 21 or 24 word recovery phrase." : "This recovery phrase is not valid.");
  open.get(walletId)?.release();
  const account = net.keys.fromPhrase(phrase.trim(), { account: 0, index });
  open.set(walletId, account);
  return account;
}

export function lockAll(): void {
  for (const account of open.values()) account.release();
  open.clear();
}

export function watchAddress(net: Network, text: string): string {
  const result = Address.check(text.trim(), net);
  if (!result.ok) throw new Error(`Check the address (${result.reason}).`);
  return Address.parse(text.trim(), net).toString();
}
```

### 4. Balances, history and validators

- Replace `loadDemoData` for real wallets with reads: `net.accounts.get(address)` for balances and the current vote, `net.history.forAccount(address, { page, limit })` for activity, `net.validators.list()` for the directory.
- Replace `formatDemoAmount(number)` with `Amount.format(units, net.token.decimals, { grouping: true })`. No amount is a `number` any more.
- Refresh on new blocks (`net.watch` or a timer of one block time), not per screen render.
- Keep **Explore demo** only if it stays fully separate: its screens read the fixture, never the network, and say "Demo". Real wallets never fall back to it.

### 5. Transfers

`SendFlow.tsx` already has Details, Review and Result steps. Map them to build, review and sign:

<!-- sample: pending; needs: Address.parse, Amount.parse, net.build.transfer, fee-floor, draft.summary, draft.sign, net.submit, net.transactions.wait, Draft, Account -->
```ts
// src/transfer.ts
import { Address, Amount, type Account, type Draft, type Network } from "@iceroot-network/sdk";

export type TransferEntry = { recipient: string; amount: string };

/** Details step: one transaction for all recipients, with one memo. */
export function prepareTransfer(net: Network, from: string, entries: TransferEntry[], memo: string): Promise<Draft> {
  return net.build.transfer({
    from,
    to: entries.map((entry) => ({
      address: Address.parse(entry.recipient.trim(), net),
      amount: Amount.parse(entry.amount.trim(), net.token.decimals),
    })),
    memo: memo.trim(),
  });
}

/** Result step: sign what the Review step showed, submit, and follow it to a block. */
export async function sendTransfer(net: Network, draft: Draft, account: Account) {
  const signed = draft.sign(account);
  const result = await net.submit(signed);
  if (result.status !== "accepted") return { state: "rejected" as const, reason: result.reason, id: signed.id };
  const status = await net.transactions.wait(signed.id, { until: "confirmed" });
  return { state: status.state, id: signed.id, confirmations: status.confirmations };
}
```

- The Review step renders `draft.summary` and `draft.fee`. The demo's "one receipt per recipient" goes away: a transfer to 12 recipients is one transaction with one id and one fee.
- The form's limits come from `net.rules.transfer.maxRecipients` and `net.rules.memo.maxBytes`; keep counting memo bytes with `TextEncoder`, as `memoBytes` does.
- The amount field accepts at most `net.token.decimals` fraction digits; `Amount.parse` refuses more.
- A `StaleDraft` error at submission means the network moved on: build again and show the new review.
- The Result step says "Confirmed in block N", never "final".

### Votes

The governance page's editor splits a vote evenly across the chosen validators. Wire it to `net.build.vote`:

<!-- sample: pending; needs: net.build.vote, fee-floor, net.rules.vote, draft.summary, VoteEntry -->
```ts
// src/votes.ts
import type { Network, VoteEntry } from "@iceroot-network/sdk";

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
  if (rules.maxShareBasisPoints !== null && entries.some((entry) => entry.basisPoints > rules.maxShareBasisPoints!)) {
    return `No validator can receive more than ${rules.maxShareBasisPoints / 100}% of your vote.`;
  }
  return null;
}

export function prepareVote(net: Network, from: string, entries: VoteEntry[]) {
  return net.build.vote({ from, entries });   // throws InvalidVote with details if the network refuses the entries
}
```

- `validatorId` becomes the validator's `name` everywhere (`VoteEntry`, the fixture types, `sameVote`).
- The wallet may keep proposing 20 validators at 500 basis points each as its default, which is valid on today's devnet and from the IceRoot genesis; the limits it enforces come from `net.rules.vote`.
- A validator account cannot vote from the IceRoot genesis. Check `net.accounts.get(address).validator` and hide the vote editor for validator accounts, and let the builder enforce the rule.
- When the vote library is released, `evenVote` is replaced by its `split`, and the modes are added. Keep the manual editor until then; do not implement the modes in the app.

### 6. Validator registration and resignation

Replace the previews with `net.build.registerValidator({ from, name })` and `net.build.resignValidator({ from, kind })` (`"temporary"`, `"permanent"` or `"revoke"`). The registration surcharge is part of `draft.fee`: 75 ROOT on today's devnet, 250 ROOT from the IceRoot genesis. Show `draft.fee`, never either number. Check the name with the builder's `InvalidName` error, not with a local regular expression.

### 7. Capabilities

Gate each later screen on `net.capabilities.has(...)`: names (`names`), swaps and time locks (`swaps`, `htlc`, `time-locks`), key rotation and multisig (`key-rotation`, `multisig`), assets other than ROOT (`assets`), finality (`finality`) and migrations (`migration-exit`). With 0.1.0 all of them are false on the devnet; the screens stay hidden, not disabled with an error.

## Rules that apply to the desktop wallet

- No constants for fees, decimals, recipients, memo size or vote limits ([rule 1](../rules.md)).
- Amounts are `bigint` base units; the demo's `number` amounts go away ([rule 2](../rules.md)).
- Addresses are checked against the connected network ([rule 4](../rules.md)).
- "Confirmed", never "final", on today's devnet ([rule 5](../rules.md)).
- No phrase or key in the profile state file, `localStorage` or any unencrypted file; keys for the session only until the keystore ([rule 12](../rules.md)).
- The review screen shows the draft ([rule 15](../rules.md)); votes are never recast automatically ([rule 7](../rules.md)).

## Tests to add

- Unit tests with a stub transport that returns recorded devnet responses: balances, history paging, a transfer draft to 3 recipients, a vote draft, a refused submission.
- The browser preview (Playwright) against a local devnet: create a wallet, fund it from a devnet test account in a setup script, send a transfer, see it confirmed.
- A test that no phrase reaches `app-state.json` or `localStorage`.
