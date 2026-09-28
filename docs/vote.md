# Vote selection

A vote names validators with a share of the account's vote weight each: on IceRoot at least 20 validators at no more than 500 basis points each, on today's devnet 1 to 53 entries. Few holders want to pick 20 validators by hand, so wallets offer to fill a vote in one of four modes, show why each validator was picked, and let the holder review and sign it. `@iceroot-network/sdk/vote` is that selection, computed by the SDK's Rust core: the same functions, results and error codes as the Rust crate `iceroot_sdk::vote`.

Every function is a pure function of its arguments: no I/O, no clock, no floating point. Anyone with the same snapshot, account, mode, number of picks, vote rules, draw number and library version (`iceroot-vote/1`) gets the same selection. The library never recasts a vote: it reports picks that no longer meet their criteria, and any new selection is the holder's to review and sign.

## The modes

| Mode | Id | Picks from | Weight in the draw |
|---|---|---|---|
| Diversity (recommended) | `diversity` | The seated validators and the next 10 by rank, not resigned, no jailing or equivocation in the last 30 days, at least 95 % of assigned slots forged | Spread over rank bands first and declared operators, hosting providers and regions second; declarations can at most double a weight |
| Reliability | `reliability` | At least 7 days seated in the 30-day window, a production record with at least 95 % of assigned slots forged, no jailing or equivocation in the window | Missing 1 % of slots halves the weight |
| Maximum Rewards | `maximum-rewards` | Seated, with payouts measured by an indexer (never declared rates), no jailing or equivocation in the window; at most two picks per declared operator | The square of the payout as a share of the best payer's |
| Support Newcomers | `support-newcomers` | The last 10 seats and the 20 ranks below the cutoff, registered for 7 days, complete declarations, no penalty ever; at most two picks per declared operator | Higher nearer the cutoff |
| Manual | | The holder's own choice | `split` and `validateVote` only |

When a mode has fewer eligible validators than the picks asked for, the rest comes from Diversity's pool, and the selection says so. Draws are seeded per account, so holders who choose the same mode do not all vote for the same validators.

## A snapshot of the validators

A selection is computed from a snapshot: validator data at one height. `VoteSnapshot.fromNode` reads it through the connected network.

<!-- sample: verified 0.1.0 -->
```ts
import { VoteSnapshot } from "@iceroot-network/sdk/vote";

const snapshot = await VoteSnapshot.fromNode(net);
snapshot.source;              // "relay-approximate"
snapshot.records.length;      // every registered validator
```

- **What it reads.** Every page of the validator list, the validator registrations (for registration heights) and, for each validator that forged, its first forged block (for its seated days, at most 30). On today's devnet that is one request per such validator; `fromNode(net, { firstForged: false, registrations: false })` reads the list alone.
- **What a vote may name.** A validator that has not resigned and is listed without a `version` is left out: a node refuses a vote naming it until it sees the validator's node running (see [Signing the vote](#signing-the-vote)).
- **Who the snapshot trusts.** The relay that answers supplies every figure of the snapshot, the height and the seat count included, and the draws' seed rounds that height to an election interval. With genuine data a relay can therefore choose between the seeds of about two neighbouring intervals, by reporting a height that is not the latest; with false data it can shape the snapshot as it likes. Read snapshots from a relay you trust, and offer "Draw again".
- **What a node cannot give.** A node has lifetime counters only, so production is the lifetime count and the snapshot is marked `relay-approximate`, which every selection records. There are no declarations, payouts or penalty records: Diversity works on rank bands alone, Maximum Rewards and Support Newcomers top up from Diversity and say so, and on a young chain Reliability's pool is empty until validators have 7 days of seated history. An indexer supplies these figures in a later release.
- **Offline.** `VoteSnapshot.fromValidators(chain, height, validators, lookups)` builds the same snapshot from records the app read itself. `VoteSnapshot.serialize` and `VoteSnapshot.deserialize` turn a snapshot into text and back (heights and weights as decimal strings), for a cache or a worker.

## Selecting

<!-- sample: verified 0.1.0 -->
```ts
import { VoteRules, select } from "@iceroot-network/sdk/vote";

const selection = select(snapshot, {
  mode: "diversity",
  account: account.address,     // part of the seed
  rules: VoteRules.of(net),     // the vote rules in force; never write them by hand
  count: 20,                    // optional: 20 to 53, 20 by default (500 basis points each on IceRoot)
  draw: 0,                      // optional: one more for each "Draw again"
});

selection.entries;              // the picks in the protocol's order: validator, basisPoints, source, step, reasons
selection.vote;                 // the vote to sign: { validator, basisPoints }[]
selection.topUpNotice;          // a sentence when picks came from Diversity, else null
selection.sizeNotice;           // a sentence when fewer picks than asked for fit the vote's byte limit, else null
```

`VoteRules.of(net)` gives the rules in force at the next block: the limits of the milestone and the name rule of the format stage (today's devnet names on the devnet, lowercase letters from the IceRoot genesis). `VoteRules.ICEROOT` and `VoteRules.SOLAR_COMPATIBLE` are the two stages' rules, for tests and previews.

### The review screen

Each pick carries its reasons: the criteria it meets, its groups and its chance at the step it was drawn. Each reason has a `kind`, its values and `text`, a plain English sentence for the screen. Names a validator declared (operator, hosting provider) appear in quotes, with control and invisible characters escaped, since they are the validator's statements.

<!-- sample: verified 0.1.0 -->
```ts
for (const pick of selection.entries) {
  const lines = pick.reasons.map((reason) => reason.text);
  // "Drawn at step 3 from the Diversity pool of 58 candidates, with a chance of 2.46 %", ...
  const drawn = pick.reasons.find((reason) => reason.kind === "drawn");
  void [pick.validator, pick.basisPoints, lines, drawn];
}
```

Heights, days since registration, vote weights, payouts and draw weights are `bigint`; every other value is a `number`. Offer "Draw again" by selecting again with `draw` one higher. The [example wallet](../examples/vite-react-wallet/README.md)'s `src/Vote.tsx` is a complete review screen, from the snapshot to the check of a kept selection.

### Signing the vote

The selection's vote is an ordinary vote: build it, show the draft's summary, and sign what the holder reviewed.

<!-- sample: verified 0.1.0 -->
```ts
const draft = await net.build.vote({ from: account, entries: selection.vote });
showForApproval(draft.summary);
const signed = draft.sign(account);
await net.submit(signed);
```

A node refuses a vote that names a validator which has not resigned and whose node it has not seen running in the last rounds (node code `ERR_OFFLINE`, "genesis_7 is not operating a node on the network"): a validator registered without a node, one whose node stopped, and on a new devnet every validator until its node is seen. `net.validators.list()` shows such a validator without a `version`, and `VoteSnapshot.fromNode` and `fromValidators` leave it out of the snapshot, so no selection names it. A validator can still stop between the snapshot and the submission: show the node's message when a vote is rejected, and offer to read the validators again.

## Checking a vote later

Validators resign, get jailed or stop producing. Keep the selection, and later check it against a newer snapshot. `check` never changes anything: it tells the holder which picks no longer meet their criteria, and the wallet may offer a new selection for the holder to review and sign.

<!-- sample: verified 0.1.0 -->
```ts
import { Selection, VoteSnapshot, check } from "@iceroot-network/sdk/vote";

const saved = Selection.serialize(selection);    // store it with the account's settings

const findings = check(Selection.deserialize(saved), await VoteSnapshot.fromNode(net));
for (const finding of findings.filter((each) => !each.stillMeets)) {
  showRefusal(`${finding.validator}: ${finding.why}`);   // for example "Validator resigned for good"
}
```

A pick from the mode is judged by the mode, a top-up by Diversity. A validator the holder put in by hand (`source: "holder"`) is judged only by whether it is still in the snapshot and has not resigned. A pick missing from the newer snapshot is reported as "No longer among the validators a vote can name": it is no longer registered, or a node would refuse a vote naming it now.

## Manual voting

<!-- sample: verified 0.1.0 -->
```ts
import { VoteRules, split, validateVote, voterOf } from "@iceroot-network/sdk/vote";

const entries = split(["genesis_1", "genesis_2", "genesis_3"]);   // 3334, 3333 and 3333 basis points
const problems = validateVote(entries, VoteRules.of(net), voterOf(snapshot, account.address));
for (const problem of problems) {
  showRefusal(problem.text);   // problem.reason: "too-few-entries", "share-too-large", "name", ...
}
```

`split` shares 10,000 basis points as evenly as whole basis points allow, the remainder one each to the first validators, in the protocol's order. `validateVote` lists every problem in a fixed order (the voter, the count, each entry, the total, the size), and an empty list is a valid vote.

## Errors

The vote library's errors are `IceRootError`s with these codes; their classes are exported by `@iceroot-network/sdk/vote`.

| Code | When | `details` |
|---|---|---|
| `InvalidPickCount` | `count` outside 20 to 53, or below the rules' fewest entries | `count`, `minimum`, `maximum` |
| `ValidatorCannotVote` | The account belongs to a validator that has not resigned for good | |
| `InvalidSnapshot` | A snapshot the library cannot use; `error.reason` says why | `reason` (`window`, `no-seats`, `no-block-time`, `name`, `duplicate-name`, `duplicate-address`, `inconsistent` with `name` and `field`) |
| `NotEnoughValidators` | The mode's pool and Diversity's together are too small | `requested`, `available` |
| `DoesNotFit` | Fewer than the minimum picks fit the rules' limits on entries and bytes | `fits`, `minimum`, `maxEntries`, `maxBytes` |
| `BreaksRules` | The rules do not fit the snapshot's names or shares, for example IceRoot's rules against today's devnet names; `error.problems` lists them | `problems` |
| `InvalidVote` | `split` of more than 10,000 validators | `reason`, `count`, `maximum` |

## In a classic script

The classic-script build carries the library as the namespace `vote` of its global: `IceRootSdk.vote.select(snapshot, request)`, `IceRootSdk.vote.VoteRules.of(net)` and so on.
