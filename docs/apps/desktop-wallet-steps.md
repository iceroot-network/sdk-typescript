# Step by step: the desktop wallet from sample data to the SDK

This page replaces the desktop wallet's sample-data layer, `src/mockData.ts` and `src/demoSession.ts`, with SDK calls, one step at a time, and says what changes in the files that use them (`src/vote.ts`, `src/App.tsx`, `src/SendFlow.tsx`, `src/DemoPages.tsx`). The [integration guide](desktop-wallet.md) says what to wire in this release and what waits; this page is the order of work. The wallet uses the SDK's native Tauri plugin and imports `@iceroot-network/sdk/tauri`, whose calls return promises where the plugin computes. The [example wallet](../../examples/vite-react-wallet/README.md) in this repository is working code for every step on the WebAssembly entry, with the same calls not awaited: it creates and restores wallets, shows the balance and history, sends, votes in the four modes with a review screen and checks a vote later, and signs in to a website.

The reference wiring is `iceroot-network/desktop-wallet`. Each step names the module of that wallet that matches it (`src/walletData.ts`, `src/session.ts`, `src/keys.ts`, `src/network.ts`, `src/vote.ts`, `src/voteModes.ts`). Until the native plugin is wired there, it runs the WebAssembly entry with the Tauri HTTP plugin as transport, so its calls are not awaited. The functions below are the same with the plugin's awaits.

Read first: [Integration guide: desktop wallet](desktop-wallet.md), [Vote selection](../vote.md), [Rules](../rules.md).

## What goes where

| Today | After | Step |
|---|---|---|
| `src/mockData.ts`: `loadDemoData()`, `DemoData`, `DemoWallet`, `DemoAsset`, `DemoValidator`, `DemoTransaction` | `src/walletData.ts`: `loadWalletData(net, wallets)` over `AccountInfo`, `ValidatorInfo` and `TxRecord` | 2 |
| `src/mockData.ts`: `formatDemoAmount(number)`, the `DEMO-` reference check | `Amount.format(units, net.token.decimals)`, `Address.check(text, net)`, awaited | 2 |
| `src/demoSession.ts`: `demoTransfer`, `DemoTransferEntry`, `DemoTransferResult`, `MAX_TRANSFER_RECIPIENTS`, `MAX_MEMO_BYTES`, `memoBytes`, 18 decimals | `src/session.ts`: `prepareTransfer` (build, with no key), the Review step shows the draft, `send` (open the key, sign, submit, wait); limits from `net.rules` | 3 |
| `src/demoSession.ts`: `demoVote`, `DEMO_VOTE_FEE` | `src/session.ts`: `prepareVote` and `send`; the fee is `draft.fee` | 3 |
| `src/vote.ts`: `VOTE_MIN_VALIDATORS`, `VOTE_MAX_VALIDATORS`, `VOTE_MAX_SHARE`, `VOTE_TOTAL`, `voteProblem`, `evenVote`, `sameVote`; `VoteEntry.validatorId` | `src/vote.ts` over the vote library: `VoteRules.of(net)`, `validateVote`, `split`; `VoteEntry.validator` | 4 |
| The governance page's hand-picked vote only | The four modes with every pick's reasons, and a check of the kept selection | 5 |
| `src/App.tsx`: `openDemo()`, `simulateTransfer`, `simulateVote`; `SendFlow`'s `demoBalance` and `onTransfer` | A connected network, session keys, and the functions above | 6 |
| `public/mock-test-api.json` | Deleted, or kept only behind a separate, labelled Explore demo | 7 |

Every amount becomes a `bigint` of base units, and every limit, fee and rule comes from the network. Today's devnet has 8 decimals, not 18, and its vote rules differ from IceRoot's (1 to 53 entries, no per-validator cap), so the constants of `demoSession.ts` and `vote.ts` would be wrong there even before they were sample data.

## 1. Connect, and keep keys in the plugin

Install the package and register the plugin as in steps 1 to 3 of the [integration guide](desktop-wallet.md#wiring-steps): `src/network.ts` gives one connected `Network`, and `src/keys.ts` keeps each wallet's phrase as a [keystore](../keystore.md) with the desktop preset and opens its account in the plugin when the holder unlocks. A profile's wallets keep their `WalletReference` (`kind`, `address` and the public key) and the keystore's text in `storage.ts`, never a phrase, key or password. The public key is what lets the wallet build drafts with no key open (step 3).

Two things to get right in this step:

- **Check the address on every unlock.** A wrong index, another wallet's keystore or a changed scheme each give a valid key of an address the holder never saw. `openWallet` in the reference wallet's `src/keys.ts` requires the saved address and refuses a key of another ([rule 17](../rules.md)). The sample in the [integration guide](desktop-wallet.md#3-wallets-watch-create-import) shows it with the plugin. Opening a key needs a profile only, not a network.
- **Pass no built-in `fetch` as a transport.** The native plugin takes none. On the interim WebAssembly path, `connect(profile, isTauri() ? { transport: tauriFetch } : {})` with the HTTP plugin's `fetch`, as in `src/network.ts`. `globalThis.fetch` fails with "Illegal invocation" in a webview, since the SDK calls the transport as a method ([integration guide, step 2](desktop-wallet.md#2-the-network)).

The example wallet does the same in the browser with the `web` preset (`examples/vite-react-wallet/src/Setup.tsx` and `Unlock.tsx`).

## 2. Replace `mockData.ts`

The fixture's types become the SDK's records. Keep the file's role, one module that loads what the pages show, and read the network instead:

<!-- sample: verified 0.1.0 -->
```ts
// src/walletData.ts: replaces src/mockData.ts
import { Address, Amount, balanceOf, type AccountInfo, type Network, type TxRecord, type ValidatorInfo } from "@iceroot-network/sdk/tauri";

/** A wallet of the profile, as storage.ts keeps it. */
export type WalletRef = { readonly id: string; readonly name: string; readonly address: string };

/** One wallet as the pages show it: replaces DemoWallet. */
export type WalletView = {
  readonly ref: WalletRef;
  readonly info: AccountInfo;   // balances per asset, nonce, the current vote (entries of { validator, basisPoints })
  readonly balance: bigint;     // ROOT in base units; was `balance: number`
};

/** What the pages read: replaces DemoData. */
export type WalletData = {
  readonly wallets: readonly WalletView[];
  readonly validators: readonly ValidatorInfo[];
  readonly height: bigint;      // the node's last block; replaces snapshotAt
};

/** Replaces loadDemoData(). A node failure throws: the pages show an error and a retry, never sample data. */
export async function loadWalletData(net: Network, refs: readonly WalletRef[]): Promise<WalletData> {
  const status = await net.refresh();
  const wallets = await Promise.all(
    refs.map(async (ref) => {
      const info = await net.accounts.get(ref.address);
      return { ref, info, balance: balanceOf(info) };
    }),
  );
  const validators: ValidatorInfo[] = [];
  for (let page = 1; ; page += 1) {
    const listing = await net.validators.list({ page, limit: 100 });
    validators.push(...listing.items);
    if (!listing.hasNext) break;
  }
  return { wallets, validators, height: status.height };
}

/** Replaces the fixture's transactions[]: one page of a wallet's history, newest first. */
export async function historyOf(net: Network, address: string, page = 1): Promise<readonly TxRecord[]> {
  return (await net.history.forAccount(address, { page, limit: 25 })).items;
}

/** Replaces formatDemoAmount(number): formatted in the plugin, when the data is loaded. */
export async function formatAmount(net: Network, units: bigint): Promise<string> {
  return `${await Amount.format(units, net.token.decimals, { grouping: true })} ${net.token.symbol}`;
}

/** Replaces the DEMO- reference check, for wallets and contacts: null when the address is one of this network's. */
export async function addressProblem(net: Network, text: string): Promise<string | null> {
  const check = await Address.check(text.trim(), net);
  return check.ok ? null : `Check the address (${check.reason}).`;
}

/** Replaces DemoValidator.uptime: produced against assigned slots, in percent, from the node's lifetime counters. */
export function uptime(validator: ValidatorInfo): number | null {
  const assigned = validator.production.produced + validator.production.missed;
  return assigned === 0n ? null : Number((validator.production.produced * 10_000n) / assigned) / 100;
}
```

Text that comes from the chain is not safe to show as it is. Add the reference wallet's `safeText` to this file and show every memo, validator name and address of a record through it ([rule 16](../rules.md)). It writes control characters, line and paragraph separators and bidirectional formatting characters as `\uXXXX`, so a memo cannot reorder or split what the holder reads. The lines of `draft.summary` are escaped by the SDK already.

<!-- sample: verified 0.1.0 -->
```ts
// src/walletData.ts, continued
/** Text from the chain or the node, made safe to show: a memo, a validator's name, an address in a record. */
export function safeText(text: string): string {
  // The same characters as the SDK's own escaping of `draft.summary.lines`.
  return text.replace(/[\\\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu, (char) =>
    char === "\\" ? "\\\\" : `\\u${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`);
}
```

Field by field:

| `mockData.ts` | `walletData.ts` |
|---|---|
| `DemoWallet.address` (`DEMO-...`) | `WalletView.ref.address`, checked with `addressProblem` when saved |
| `DemoWallet.balance`, `openingBalance` | `WalletView.balance` (`bigint`); there is no opening balance: show the history instead |
| `DemoWallet.assets[]` | `WalletView.info.balances`; one entry, ROOT, on today's devnet |
| `DemoWallet.vote` | `WalletView.info.vote`, whose entries name the validator (`validator`, not `validatorId`) |
| `DemoAsset` (`id: "root"`, `decimals`, `symbol`) | `net.token` (`assetId`, `decimals`, `symbol`) |
| `DemoValidator.rank`, `status`, `votingBalance`, `validatedBlocks`, `address` | `ValidatorInfo.rank`, `status`, `voteWeight`, `production.produced`, `address` |
| `DemoValidator.uptime` | `uptime(validator)` |
| `DemoValidator.tagline`, `color` | Not chain data: leave them out, or take the tagline from the validators portal later |
| `DemoTransaction` | `TxRecord` from `historyOf`: `details.kind`, `direction`, `status`, `block?.height`, `fee`, `memo`, `details.recipients` |
| `snapshotAt`, `historyStartsAt` | `WalletData.height`; history is paged from the node |
| The checks of `loadDemoData` (DEMO- references, the `^[a-z]{1,20}$` validator name, the vote rules) | Gone: the node's records are typed, addresses are checked with `Address.check` against the network, and votes with `validateVote` (step 4) |

In `DemoPages.tsx`, the pages take `WalletData` instead of `DemoData`, and every `formatDemoAmount(x)` becomes the text of `formatAmount(net, x)` with `x` a `bigint`, computed when the data loads (keep the formatted strings next to the amounts in the page's state). Arithmetic on amounts stays in `bigint` (the asset allocation bar's share of a total, for example, is `Number((part * 10_000n) / total) / 100`).

## 3. Replace `demoSession.ts`

`demoTransfer` and `demoVote` changed the fixture in memory in one call. A real operation has three steps, which `SendFlow.tsx` and the governance page already show as Details, Review and Result: build a draft from the network, show exactly the draft, then sign, submit and follow it into a block.

<!-- sample: verified 0.1.0 -->
```ts
// src/session.ts: replaces src/demoSession.ts
import { Address, Amount, IceRootError, type Account, type Draft, type Network, type VoteEntry } from "@iceroot-network/sdk/tauri";

/** Who a draft is from: an open account, or a public key or an address as text. Prefer the text. */
export type Sender = Account | string;

/**
 * The sender to build with for a saved wallet, with no key: its public key when the wallet kept
 * one, else its address. A kept public key must give the kept address.
 */
export async function senderOf(net: Network, wallet: { readonly address: string; readonly publicKey?: string }): Promise<string> {
  if (wallet.publicKey === undefined) return wallet.address;
  if ((await Address.fromPublicKey(wallet.publicKey, net)).toString() !== wallet.address) {
    throw new Error("This wallet's public key does not match its address. Remove the wallet and import it again.");
  }
  return wallet.publicKey;
}

/** One row of the Details step, as typed. */
export type TransferEntry = { readonly recipient: string; readonly amount: string };

/** Replaces MAX_TRANSFER_RECIPIENTS and MAX_MEMO_BYTES: the network's own limits. */
export function transferLimits(net: Network) {
  return { maxRecipients: net.rules.transfer.maxRecipients, maxMemoBytes: net.rules.memo.maxBytes };
}

/** Kept from demoSession.ts: a memo's size is its UTF-8 bytes. */
export const memoBytes = (memo: string) => new TextEncoder().encode(memo).length;

/** Details step of a transfer: one transaction to every recipient, with one memo and one fee. Replaces the first half of demoTransfer. No key is open. */
export async function prepareTransfer(net: Network, from: Sender, entries: readonly TransferEntry[], memo: string): Promise<Draft> {
  const to = await Promise.all(
    entries.map(async (entry) => ({
      address: await Address.parse(entry.recipient.trim(), net),
      amount: await Amount.parse(entry.amount.trim(), net.token.decimals),   // at most net.token.decimals fraction digits
    })),
  );
  return net.build.transfer({ from, to, memo: memo.trim() });
}

/** Details step of a vote: replaces the first half of demoVote. An empty vote withdraws the account's vote. */
export function prepareVote(net: Network, from: Sender, entries: readonly VoteEntry[]): Promise<Draft> {
  return net.build.vote({ from, entries });
}

/** Result step: replaces DemoTransferResult. One transaction has one id, however many recipients it pays. */
export type SendResult =
  | { readonly state: "confirmed"; readonly id: string; readonly height: bigint | undefined }
  | { readonly state: "rejected" | "dropped" | "not-yet"; readonly id: string; readonly reason?: string };

/**
 * Result step: the key is opened now, after the Review step. The plugin signs the draft that step
 * showed; submits it and waits for a block. Replaces the second half of demoTransfer and demoVote.
 */
export async function send(net: Network, draft: Draft, account: Account): Promise<SendResult> {
  let signed;
  try {
    signed = await draft.sign(account);   // WrongKey if the account is not the draft's sender
  } finally {
    await account.release();   // the key is needed only for the signing
  }
  const result = await net.submit(signed);
  if (result.status !== "accepted") return { state: "rejected", id: signed.id, reason: result.reason };
  try {
    const outcome = await net.transactions.wait(signed.id, { until: "confirmed" });
    if (outcome.state === "dropped") return { state: "dropped", id: signed.id };
    return { state: "confirmed", id: signed.id, height: outcome.record.block?.height };
  } catch (error) {
    if (error instanceof IceRootError && error.code === "Timeout") return { state: "not-yet", id: signed.id };
    throw error;
  }
}
```

What changes for the screens:

- **Build with no key.** `from` is the sender's public key or address, or an open `Account`. The public key works for every account. An address works once the account has sent a transaction; for a new account the builder refuses it with `InvalidArgument`, which is why the wallet keeps the public key with the address and builds with `await senderOf(net, wallet)`. Do not open a key just to get a quote.
- **Details.** `SendFlow.tsx`'s `canReview` drops the `DEMO-` and 18-decimal patterns: check each recipient with `await Address.check(text, net)` and each amount with `await Amount.parse` (its `InvalidAmount` says what is wrong), as the fields change. The recipient and memo limits come from `transferLimits(net)`.
- **Review.** Nothing is signed and no key is open. Render `draft.summary.lines` (one line per effect, then the memo and the fee), `draft.fee` and `draft.summary.total`, all computed from the transaction's own fields. The demo's fee of 0.1 ROOT per recipient and `DEMO_VOTE_FEE` go away: the fee is `draft.fee`, resolved from the network's fee floor.
- **Result.** The holder confirms, the wallet opens the key (`unlock`, which checks the saved address), and `send` signs, releases the key and submits. "Confirmed in block N", never "final": today's devnet has no finality (`net.capabilities.has("finality")` is false). A `rejected` result with reason `nonce` means the account sent another transaction since the draft was built: build again and show the new review. A `rejected` result of a vote with node code `ERR_OFFLINE` means the node has not seen a chosen validator running yet (step 5). A `not-yet` result says to check the history later; it is not a failure.
- **Balances.** The demo subtracted amounts itself. After a confirmed result, read the account again (`loadWalletData`); never compute a balance locally.

## 4. Replace the rules of `vote.ts`

The vote editor's constants and checks become the network's rules and the vote library's checks; the helpers that only format stay.

<!-- sample: verified 0.1.0 -->
```ts
// src/vote.ts: the rules come from the network
import type { Network, VoteEntry } from "@iceroot-network/sdk/tauri";
import { VoteRules, split, validateVote, type Voter } from "@iceroot-network/sdk/tauri/vote";

export type { VoteEntry };   // { validator, basisPoints }: the validator's name, which the vote carries

/** Replaces VOTE_MIN_VALIDATORS, VOTE_MAX_VALIDATORS and VOTE_MAX_SHARE. */
export async function voteLimits(net: Network) {
  const rules = await VoteRules.of(net);
  return { min: rules.minEntries, max: rules.maxEntries, maxShare: rules.maxEntryBasisPoints };
}

/** Replaces voteProblem: the first problem's sentence, or null. An empty vote withdraws. */
export async function voteProblem(net: Network, entries: readonly VoteEntry[], voter: Voter = "ordinary"): Promise<string | null> {
  return (await validateVote(entries, await VoteRules.of(net), voter))[0]?.text ?? null;
}

/** Replaces evenVote: whole basis points, the first names take the remainder, in the protocol's order. */
export async function evenVote(names: readonly string[]): Promise<VoteEntry[]> {
  return names.length === 0 ? [] : split(names);
}

/** Kept, with names in place of ids. */
export function sameVote(a: readonly VoteEntry[], b: readonly VoteEntry[]): boolean {
  const shares = new Map(a.map((entry) => [entry.validator, entry.basisPoints]));
  return a.length === b.length && b.every((entry) => shares.get(entry.validator) === entry.basisPoints);
}
```

- `VOTE_TOTAL` goes away: `split` shares the whole vote.
- `formatShare` and `shareSummary` stay as they are.
- Rename `validatorId` to `validator` wherever a vote entry appears (`DemoPages.tsx`'s picker and the saved votes); the vote carries validator names.
- A validator's account cannot vote from the IceRoot genesis. Pass `await voterOf(snapshot, address)` as the voter (step 5), and hide the editor when `validateVote` reports `validator-account`.

## 5. Add the vote modes to the governance page

The governance page asks for a hand-picked vote today. The vote library fills one in any of four modes and explains every pick; the manual editor of step 4 stays as the fifth choice. The example's `examples/vite-react-wallet/src/Vote.tsx` is the whole screen.

<!-- sample: verified 0.1.0 -->
```ts
// src/voteModes.ts: selections, their review, and the check of a kept selection
import type { Account, Network } from "@iceroot-network/sdk/tauri";
import { MODE_NAMES, Selection, VoteRules, VoteSnapshot, check, select, type Mode } from "@iceroot-network/sdk/tauri/vote";

/**
 * Read once per visit of the page: on today's devnet one request per validator that has forged,
 * within the node's allowance of about 100 requests per minute, so it can take a minute or more.
 */
export function readSnapshot(net: Network): Promise<VoteSnapshot> {
  return VoteSnapshot.fromNode(net);
}

/** A selection for the review screen; `draw` is one higher for each "Draw again". */
export async function choose(net: Network, snapshot: VoteSnapshot, account: Account, mode: Mode, count: number, draw: number): Promise<Selection> {
  return select(snapshot, { mode, account: account.address, rules: await VoteRules.of(net), count, draw });
}

/** What the review screen shows for each pick: its share, where it came from, and every reason's sentence. */
export function reviewLines(selection: Selection) {
  return selection.entries.map((pick) => ({
    validator: pick.validator,
    share: `${pick.basisPoints / 100}%`,
    source: pick.source === "top-up" ? "Top-up from Diversity" : `From ${MODE_NAMES[selection.mode]}`,
    reasons: pick.reasons.map((reason) => reason.text),
  }));
}

/** When the wallet opens: the picks of the kept selection that no longer meet their criteria. Nothing is recast. */
export async function stalePicks(net: Network, kept: string): Promise<string[]> {
  const findings = await check(Selection.deserialize(kept), await VoteSnapshot.fromNode(net));
  return findings.filter((finding) => !finding.stillMeets).map((finding) => `${finding.validator}: ${finding.why}`);
}
```

- **The review screen** shows `selection.topUpNotice` and `selection.sizeNotice` when they are set, then each pick with its share, its source and its reasons. On today's devnet Reliability, Maximum Rewards and Support Newcomers have no eligible validators (no payouts, declarations or 7 days of seats yet) and top up from Diversity; the notice says so, and the screen must show it.
- **Slow read.** Show that the snapshot is being read, read it once per visit of the page and reuse it for every "Draw again". `fromNode(net, { firstForged: false, registrations: false })` reads only the list, when the modes that need the rest are not offered.
- **A new devnet accepts no votes at first.** The node refuses a vote for a validator it has not seen running, and on a new devnet that is every validator until the first round has passed ([devnet](../devnet.md#a-new-devnet-and-its-first-round)). The snapshot leaves them out, so a selection may be short until then. A test that must vote early waits until at least 20 validators in `net.validators.list()` have a `version`, bounded by twice the seats in blocks.
- **Chain text.** Show validator names and every reason's text through `safeText` ([rule 16](../rules.md)).
- **Signing.** Build the vote with `prepareVote(net, await senderOf(net, wallet), selection.vote)` and show the draft as for a transfer. The snapshot leaves out validators a node would refuse a vote for (not resigned, no node of theirs seen running; see [Vote selection](../vote.md#signing-the-vote)), but one can still stop between the snapshot and the submission: show the node's message (node code `ERR_OFFLINE`) and offer to read the validators again. After a confirmed result, keep `Selection.serialize(selection)` with the wallet in the profile's storage (it holds validator names and the draw, nothing secret).
- **Later.** When the wallet opens, run `stalePicks` on the kept selection and tell the holder which picks no longer meet their criteria, for example "genesis_12: Validator resigned for now". Offer a new selection; never sign one automatically.

## 6. Rewire `App.tsx` and the pages

- `openDemo()` loaded the fixture into a demo profile. A real profile connects and loads `loadWalletData(net, profile.wallets)` with no key open, since reading and quoting need only the address and the public key. The holder enters the keystore's password only to confirm a transaction (or to see the recovery phrase), and `src/keys.ts` then opens the account in the plugin and checks it against the saved address.
- `simulateTransfer(entries, memo)` becomes the Details, Review and Result steps of step 3: `prepareTransfer` with `senderOf`, the review, then `unlock` and `send`. `SendFlow`'s `onTransfer` becomes asynchronous, and `demoBalance?: number` becomes `balance?: bigint`, formatted with `formatAmount`.
- `simulateVote(walletId, vote)` becomes `prepareVote` and `send`, with the entries of step 4 or 5.
- `DemoOverview`, `DemoWallets`, `DemoAssets`, `DemoActivity`, `DemoGovernance` and `DemoReceive` read `WalletData` and `historyOf`. Rename them once they no longer read the fixture.
- Refresh after a confirmed result and on new blocks (`net.watch`, or a timer of one block time), not on every render.
- Keep the profile's other state (appearance, contacts, hidden balances) as it is. Contacts' addresses are checked with `addressProblem` against the connected network.

## 7. Remove the fixture

Delete `src/mockData.ts`, `src/demoSession.ts` and `public/mock-test-api.json`, or keep the Explore demo only if it stays fully separate: its screens read the fixture and never the network, say "Demo" on every screen, and no real wallet falls back to it ([rule 13](../rules.md)).

Then check the result against the [review checklist](../rules.md#checklist-for-a-review): no fee, decimal count, recipient or memo limit, or vote rule is a constant; no amount is a `number`; every typed address is checked against the network; the review screens render the draft; drafts are built with no key open; a reopened wallet's key is checked against the saved address; chain text goes through `safeText`; nothing says "final".

## Tests

- The example wallet's end-to-end test (`test/e2e/wallet.e2e.ts`, run by `npm run test:e2e`) shows the flows against a local devnet in Chromium: create, restore, reload and unlock, send to two recipients, a vote in each mode with every pick's reasons, a check that flags a resigned validator, and sign-in. The same scenario of the SDK's own end-to-end test runs through the plugin in a Tauri app under `tauri-driver` (`npm run test:e2e -- --only tauri`).
- In the desktop wallet: the app under `tauri-driver` against a local devnet, and unit tests of `walletData.ts` (including `safeText` on a memo with U+202E and a line break), `keys.ts` (a key of another address is refused) and `session.ts` (a draft is built from the public key with no key open) with the SDK replaced by a stub fed with recorded devnet answers (a balance, a history page, a transfer to 3 recipients, a vote, a refused submission), as the [integration guide](desktop-wallet.md#tests-to-add) lists.
