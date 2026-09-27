# Step by step: the desktop wallet from sample data to the SDK

This page replaces the desktop wallet's sample-data layer, `src/mockData.ts` and `src/demoSession.ts`, with SDK calls, one step at a time, and says what changes in the files that use them (`src/vote.ts`, `src/App.tsx`, `src/SendFlow.tsx`, `src/DemoPages.tsx`). The [integration guide](desktop-wallet.md) says what to wire in this release and what waits; this page is the order of work. The [example wallet](../../examples/vite-react-wallet/README.md) in this repository is working code for every step: it creates and restores wallets, shows the balance and history, sends, votes in the four modes with a review screen and checks a vote later, and signs in to a website.

Read first: [Integration guide: desktop wallet](desktop-wallet.md), [Vote selection](../vote.md), [Rules](../rules.md).

## What goes where

| Today | After | Step |
|---|---|---|
| `src/mockData.ts`: `loadDemoData()`, `DemoData`, `DemoWallet`, `DemoAsset`, `DemoValidator`, `DemoTransaction` | `src/walletData.ts`: `loadWalletData(net, wallets)` over `AccountInfo`, `ValidatorInfo` and `TxRecord` | 2 |
| `src/mockData.ts`: `formatDemoAmount(number)`, the `DEMO-` reference check | `Amount.format(units, net.token.decimals)`, `Address.check(text, net)` | 2 |
| `src/demoSession.ts`: `demoTransfer`, `DemoTransferEntry`, `DemoTransferResult`, `MAX_TRANSFER_RECIPIENTS`, `MAX_MEMO_BYTES`, `memoBytes`, 18 decimals | `src/session.ts`: `prepareTransfer` (build), the Review step shows the draft, `send` (sign, submit, wait); limits from `net.rules` | 3 |
| `src/demoSession.ts`: `demoVote`, `DEMO_VOTE_FEE` | `src/session.ts`: `prepareVote` and `send`; the fee is `draft.fee` | 3 |
| `src/vote.ts`: `VOTE_MIN_VALIDATORS`, `VOTE_MAX_VALIDATORS`, `VOTE_MAX_SHARE`, `VOTE_TOTAL`, `voteProblem`, `evenVote`, `sameVote`; `VoteEntry.validatorId` | `src/vote.ts` over the vote library: `VoteRules.of(net)`, `validateVote`, `split`; `VoteEntry.validator` | 4 |
| The governance page's hand-picked vote only | The four modes with every pick's reasons, and a check of the kept selection | 5 |
| `src/App.tsx`: `openDemo()`, `simulateTransfer`, `simulateVote`; `SendFlow`'s `demoBalance` and `onTransfer` | A connected network, session keys, and the functions above | 6 |
| `public/mock-test-api.json` | Deleted, or kept only behind a separate, labelled Explore demo | 7 |

Every amount becomes a `bigint` of base units, and every limit, fee and rule comes from the network. Today's devnet has 8 decimals, not 18, and its vote rules differ from IceRoot's (1 to 53 entries, no per-validator cap), so the constants of `demoSession.ts` and `vote.ts` would be wrong there even before they were sample data.

## 1. Connect and hold keys for the session

Install the package and change the CSP and the HTTP plugin as in steps 1 to 3 of the [integration guide](desktop-wallet.md#wiring-steps): `src/network.ts` gives one connected `Network`, and `src/keys.ts` holds a key handle per wallet for the session. A profile's wallets keep their `WalletReference` (`kind` and `address`) in `storage.ts`, never a phrase or key.

The example wallet keeps its phrase in a [keystore](../keystore.md) in the browser (`examples/vite-react-wallet/src/Setup.tsx` and `Unlock.tsx`). The desktop wallet adopts the same keystore calls with the native plugin, with the desktop preset; until then it asks for the phrase when it signs and releases the handle on lock.

## 2. Replace `mockData.ts`

The fixture's types become the SDK's records. Keep the file's role, one module that loads what the pages show, and read the network instead:

<!-- sample: verified 0.1.0 -->
```ts
// src/walletData.ts: replaces src/mockData.ts
import { Address, Amount, balanceOf, type AccountInfo, type Network, type TxRecord, type ValidatorInfo } from "@iceroot-network/sdk";

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

/** Replaces formatDemoAmount(number). */
export function formatAmount(net: Network, units: bigint): string {
  return `${Amount.format(units, net.token.decimals, { grouping: true })} ${net.token.symbol}`;
}

/** Replaces the DEMO- reference check, for wallets and contacts: null when the address is one of this network's. */
export function addressProblem(net: Network, text: string): string | null {
  const check = Address.check(text.trim(), net);
  return check.ok ? null : `Check the address (${check.reason}).`;
}

/** Replaces DemoValidator.uptime: produced against assigned slots, in percent, from the node's lifetime counters. */
export function uptime(validator: ValidatorInfo): number | null {
  const assigned = validator.production.produced + validator.production.missed;
  return assigned === 0n ? null : Number((validator.production.produced * 10_000n) / assigned) / 100;
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

In `DemoPages.tsx`, the pages take `WalletData` instead of `DemoData`, and every `formatDemoAmount(x)` becomes `formatAmount(net, x)` with `x` a `bigint`. Arithmetic on amounts stays in `bigint` (the asset allocation bar's share of a total, for example, is `Number((part * 10_000n) / total) / 100`).

## 3. Replace `demoSession.ts`

`demoTransfer` and `demoVote` changed the fixture in memory in one call. A real operation has three steps, which `SendFlow.tsx` and the governance page already show as Details, Review and Result: build a draft from the network, show exactly the draft, then sign, submit and follow it into a block.

<!-- sample: verified 0.1.0 -->
```ts
// src/session.ts: replaces src/demoSession.ts
import { Address, Amount, IceRootError, type Account, type Draft, type Network, type VoteEntry } from "@iceroot-network/sdk";

/** One row of the Details step, as typed. */
export type TransferEntry = { readonly recipient: string; readonly amount: string };

/** Replaces MAX_TRANSFER_RECIPIENTS and MAX_MEMO_BYTES: the network's own limits. */
export function transferLimits(net: Network) {
  return { maxRecipients: net.rules.transfer.maxRecipients, maxMemoBytes: net.rules.memo.maxBytes };
}

/** Kept from demoSession.ts: a memo's size is its UTF-8 bytes. */
export const memoBytes = (memo: string) => new TextEncoder().encode(memo).length;

/** Details step of a transfer: one transaction to every recipient, with one memo and one fee. Replaces the first half of demoTransfer. */
export function prepareTransfer(net: Network, from: Account, entries: readonly TransferEntry[], memo: string): Promise<Draft> {
  return net.build.transfer({
    from,
    to: entries.map((entry) => ({
      address: Address.parse(entry.recipient.trim(), net),
      amount: Amount.parse(entry.amount.trim(), net.token.decimals),   // at most net.token.decimals fraction digits
    })),
    memo: memo.trim(),
  });
}

/** Details step of a vote: replaces the first half of demoVote. An empty vote withdraws the account's vote. */
export function prepareVote(net: Network, from: Account, entries: readonly VoteEntry[]): Promise<Draft> {
  return net.build.vote({ from, entries });
}

/** Result step: replaces DemoTransferResult. One transaction has one id, however many recipients it pays. */
export type SendResult =
  | { readonly state: "confirmed"; readonly id: string; readonly height: bigint | undefined }
  | { readonly state: "rejected" | "dropped" | "not-yet"; readonly id: string; readonly reason?: string };

/** Result step: signs the draft the Review step showed, submits it and waits for a block. Replaces the second half of demoTransfer and demoVote. */
export async function send(net: Network, draft: Draft, account: Account): Promise<SendResult> {
  const signed = draft.sign(account);
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

- **Details.** `SendFlow.tsx`'s `canReview` drops the `DEMO-` and 18-decimal patterns: check each recipient with `Address.check(text, net)` and each amount with `Amount.parse` (its `InvalidAmount` says what is wrong). The recipient and memo limits come from `transferLimits(net)`.
- **Review.** Render `draft.summary.lines` (one line per effect, then the memo and the fee), `draft.fee` and `draft.summary.total`, all computed from the transaction's own fields. The demo's fee of 0.1 ROOT per recipient and `DEMO_VOTE_FEE` go away: the fee is `draft.fee`, resolved from the network's fee floor.
- **Result.** "Confirmed in block N", never "final": today's devnet has no finality (`net.capabilities.has("finality")` is false). A `rejected` result with reason `nonce` means the account sent another transaction since the draft was built: build again and show the new review. A `not-yet` result says to check the history later; it is not a failure.
- **Balances.** The demo subtracted amounts itself. After a confirmed result, read the account again (`loadWalletData`); never compute a balance locally.

## 4. Replace the rules of `vote.ts`

The vote editor's constants and checks become the network's rules and the vote library's checks; the helpers that only format stay.

<!-- sample: verified 0.1.0 -->
```ts
// src/vote.ts: the rules come from the network
import type { Network, VoteEntry } from "@iceroot-network/sdk";
import { VoteRules, split, validateVote, type Voter } from "@iceroot-network/sdk/vote";

export type { VoteEntry };   // { validator, basisPoints }: the validator's name, which the vote carries

/** Replaces VOTE_MIN_VALIDATORS, VOTE_MAX_VALIDATORS and VOTE_MAX_SHARE. */
export function voteLimits(net: Network) {
  const rules = VoteRules.of(net);
  return { min: rules.minEntries, max: rules.maxEntries, maxShare: rules.maxEntryBasisPoints };
}

/** Replaces voteProblem: the first problem's sentence, or null. An empty vote withdraws. */
export function voteProblem(net: Network, entries: readonly VoteEntry[], voter: Voter = "ordinary"): string | null {
  return validateVote(entries, VoteRules.of(net), voter)[0]?.text ?? null;
}

/** Replaces evenVote: whole basis points, the first names take the remainder, in the protocol's order. */
export function evenVote(names: readonly string[]): VoteEntry[] {
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
- A validator's account cannot vote from the IceRoot genesis. Pass `voterOf(snapshot, address)` as the voter (step 5), and hide the editor when `validateVote` reports `validator-account`.

## 5. Add the vote modes to the governance page

The governance page asks for a hand-picked vote today. The vote library fills one in any of four modes and explains every pick; the manual editor of step 4 stays as the fifth choice. The example's `examples/vite-react-wallet/src/Vote.tsx` is the whole screen.

<!-- sample: verified 0.1.0 -->
```ts
// src/voteModes.ts: selections, their review, and the check of a kept selection
import type { Account, Network } from "@iceroot-network/sdk";
import { MODE_NAMES, Selection, VoteRules, VoteSnapshot, check, select, type Mode } from "@iceroot-network/sdk/vote";

/** Read once per visit of the page: on today's devnet one request per validator that has forged. */
export function readSnapshot(net: Network): Promise<VoteSnapshot> {
  return VoteSnapshot.fromNode(net);
}

/** A selection for the review screen; `draw` is one higher for each "Draw again". */
export function choose(net: Network, snapshot: VoteSnapshot, account: Account, mode: Mode, count: number, draw: number): Selection {
  return select(snapshot, { mode, account: account.address, rules: VoteRules.of(net), count, draw });
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
  const findings = check(Selection.deserialize(kept), await VoteSnapshot.fromNode(net));
  return findings.filter((finding) => !finding.stillMeets).map((finding) => `${finding.validator}: ${finding.why}`);
}
```

- **The review screen** shows `selection.topUpNotice` and `selection.sizeNotice` when they are set, then each pick with its share, its source and its reasons. On today's devnet Reliability, Maximum Rewards and Support Newcomers have no eligible validators (no payouts, declarations or 7 days of seats yet) and top up from Diversity; the notice says so, and the screen must show it.
- **Signing.** Build the vote with `prepareVote(net, account, selection.vote)` and show the draft as for a transfer. The snapshot leaves out validators a node would refuse a vote for (not resigned, no node of theirs seen running; see [Vote selection](../vote.md#signing-the-vote)), but one can still stop between the snapshot and the submission: show the node's message (node code `ERR_OFFLINE`) and offer to read the validators again. After a confirmed result, keep `Selection.serialize(selection)` with the wallet in the profile's storage (it holds validator names and the draw, nothing secret).
- **Later.** When the wallet opens, run `stalePicks` on the kept selection and tell the holder which picks no longer meet their criteria, for example "genesis_12: Validator resigned for now". Offer a new selection; never sign one automatically.

## 6. Rewire `App.tsx` and the pages

- `openDemo()` loaded the fixture into a demo profile. A wallet of a real profile unlocks instead: the holder enters the phrase (or, with the native plugin, the keystore's password), `src/keys.ts` opens a handle, and the pages load `loadWalletData(net, profile.wallets)`.
- `simulateTransfer(entries, memo)` becomes the Details, Review and Result steps of step 3, with the selected wallet's key: `prepareTransfer`, then `send`. `SendFlow`'s `onTransfer` becomes asynchronous, and `demoBalance?: number` becomes `balance?: bigint`, formatted with `formatAmount`.
- `simulateVote(walletId, vote)` becomes `prepareVote` and `send`, with the entries of step 4 or 5.
- `DemoOverview`, `DemoWallets`, `DemoAssets`, `DemoActivity`, `DemoGovernance` and `DemoReceive` read `WalletData` and `historyOf`. Rename them once they no longer read the fixture.
- Refresh after a confirmed result and on new blocks (`net.watch`, or a timer of one block time), not on every render.
- Keep the profile's other state (appearance, contacts, hidden balances) as it is. Contacts' addresses are checked with `addressProblem` against the connected network.

## 7. Remove the fixture

Delete `src/mockData.ts`, `src/demoSession.ts` and `public/mock-test-api.json`, or keep the Explore demo only if it stays fully separate: its screens read the fixture and never the network, say "Demo" on every screen, and no real wallet falls back to it ([rule 13](../rules.md)).

Then check the result against the [review checklist](../rules.md#checklist-for-a-review): no fee, decimal count, recipient or memo limit, or vote rule is a constant; no amount is a `number`; every typed address is checked against the network; the review screens render the draft; nothing says "final".

## Tests

- The example wallet's end-to-end test (`test/e2e/wallet.e2e.ts`, run by `npm run test:e2e`) shows the flows against a local devnet in Chromium: create, restore, reload and unlock, send to two recipients, a vote in each mode with every pick's reasons, a check that flags a resigned validator, and sign-in.
- In the desktop wallet: unit tests of `walletData.ts` and `session.ts` with a stub transport that returns recorded devnet answers (a balance, a history page, a transfer to 3 recipients, a vote, a refused submission), and the Playwright preview against a local devnet, as the [integration guide](desktop-wallet.md#tests-to-add) lists.
