# Concepts

The whole API in one page. The quickstarts and integration guides use only what is described here. Names are the TypeScript ones; the Rust crates use the same names in snake case.

## Loading the module

The SDK is WebAssembly. It must be loaded once before any other call.

<!-- sample: verified 0.1.0 -->
```ts
import { init, initSync } from "@iceroot-network/sdk";

await init();                 // browsers and bundlers: fetches the .wasm next to the module
await init(wasmUrl);          // or from a URL, a Response or the bytes, if you serve the file elsewhere
initSync(bytes);              // synchronous, from the bytes: workers and classic scripts
```

- `init` and `initSync` are idempotent; calling them again does nothing.
- In Node the package loads the module itself on import. Calling `await init()` there is harmless, so shared code can always call it.
- `init` rejects with `WasmLoadFailed` when the module cannot be fetched or compiled, most often because the page's Content Security Policy lacks `'wasm-unsafe-eval'`.
- Any call before loading throws `SdkNotInitialized`.

## Networks: profiles and `connect`

A profile names one chain and how to reach it. `connect` reads the chain's configuration from a node, checks the chain's identity against the profile and returns a connected network, `net`, for everything else.

<!-- sample: verified 0.1.0 -->
```ts
import { connect, profiles } from "@iceroot-network/sdk";

const profile = profiles.devnet({
  relays: ["http://127.0.0.1:6003/api"],   // include the API base path
  nethash: savedNethash,                    // optional: the identity pinned on first contact
});
const net = await connect(profile, {
  transport: fetch,                         // optional; default globalThis.fetch
  headers: { authorization: `Bearer ${token}` },   // optional; for a relay behind a proxy that needs a token
  rateLimit: { requests: 100, windowMs: 60_000 }, // optional; this is the default, false turns it off
  timeoutMs: 15_000,                        // optional; the time allowed for one request
});

const pinned = net.profile.chain.nethash;   // store this; pass it as `nethash` next time
```

- **What `connect` reads.** The chain the node serves (`/node/configuration/crypto`: the network description, the milestones and the genesis block) and the node's configuration (`/node/configuration`: the milestone at its tip and the pool's limits), both checked against the profile, and the node's status for the current height. `net.configuration` keeps what the node reported, for example `net.configuration.pool.maxTransactionsPerRequest`.
- **One chain per profile.** A devnet is pinned on first contact: the node's network identity (the nethash on today's devnet) is recorded, and a later connection that finds another identity throws `NetworkMismatch`. The app may pin again only after asking the holder, because a changed identity means a different chain (for example a devnet that was reset).
- **Relays.** Every request goes to the first relay that answers: a relay that cannot be reached, times out, answers with a server error or answers with a redirect is skipped. The SDK follows no redirect, so a request, its headers and its body reach the listed relays only. The URL includes the API base path; the SDK appends route paths to it and never guesses the base path.
- **Transport.** Any function with the signature of `fetch`. With the Tauri plugin's entry the plugin makes every request in Rust and takes no transport; a Tauri app on the WebAssembly entry passes the HTTP plugin's `fetch` (see the [Tauri quickstart](quickstart/tauri.md)).
- **Headers.** A hosted devnet endpoint that needs a token takes it as a request header, passed in `headers` (see [Devnet](devnet.md)); the token is never part of the profile.
- **Errors.** No relay answering is `NodeUnavailable`, a request that takes longer than `timeoutMs` is `Timeout`, and a node that keeps refusing for its rate limit is `RateLimited`.
- **Built-in profiles.** Release 0.1.0 has `profiles.devnet(options)` only. Profiles for the public testnet and mainnet are added in the releases made when those chains' geneses are fixed; until then they do not exist, so no app can point at a guessed identity. Show them in a network selector as not yet available.

### What `net` tells you about the network

<!-- sample: verified 0.1.0 -->
```ts
net.stage;          // "s1" on today's devnet (the Solar-compatible formats); later "pq", then "id"
net.token;          // { assetId, name, symbol, decimals }: the labels the network configures, 8 decimals today, 18 from the IceRoot genesis
net.rules;          // vote, transfer, memo, name, burn and fee rules in force at the next block
net.economics;      // seats, block time, reward per rank, donations, fee burn share
net.capabilities.has("finality");   // false today
net.height;         // the node's height as last read: bigint
```

Never copy these values into constants. `net.rules` and `net.economics` are those of the next block (`net.nextHeight`) and follow the chain as its height is read: every answer carries the node's height, and `await net.refresh()` reads it on purpose. They differ between today's devnet and the IceRoot networks.

Rule fields used in these guides:

<!-- sample: verified 0.1.0 -->
```ts
net.rules.vote.minEntries;             // 1 today; 20 from the IceRoot genesis
net.rules.vote.maxEntries;             // 53
net.rules.vote.maxBasisPointsPerEntry; // 10000 today (no per-validator cap); 500 from the IceRoot genesis
net.rules.vote.totalBasisPoints;       // 10000
net.rules.vote.maxBytes;               // 1024 today; 1280 from the IceRoot genesis
net.rules.transfer.maxRecipients;      // 256
net.rules.memo.maxBytes;               // 255 (UTF-8 bytes, not characters)
```

`net.economics` serves displays and estimates, such as the portal's rewards calculator; nothing in it is signed:

<!-- sample: verified 0.1.0 -->
```ts
net.economics.seats;                // active validators per round (53)
net.economics.blockTimeSeconds;     // 8
net.economics.rewardsByRank;        // [{ rank, reward }]: block reward in base units for each seated rank
net.economics.donations;            // [{ address, basisPoints, purpose }]
net.economics.feeBurnBasisPoints;   // share of each fee that is burned
const supply = await net.economics.supply();   // from the node: { height, blockId, supply, burned: { fees, transactions, total } }, bigint base units
```

### Capabilities

Every network declares what it supports. An operation the network lacks throws `UnsupportedOnNetwork` with the capability's name; apps hide the feature instead of letting the error happen.

| Capability | Today's devnet | Later |
|---|---|---|
| `connect`, `phrase-accounts` | yes | yes |
| `transfer`, `burn`, `vote`, `validator-registration`, `validator-resignation`, `second-key`, `message-signing` | yes | yes |
| `legacy-passphrase-import` | yes | no: it disappears with today's devnet formats |
| `validator-names` (resolve a validator by its name) | yes | yes |
| `key-rotation`, `multisig` | no | from the post-quantum formats |
| `names` (register, resolve and send to account names) | no | from the IceRoot genesis |
| `share-declare` (declared reward sharing) | no | from the IceRoot genesis |
| `assets`, `swaps`, `htlc`, `time-locks` | no | after the IceRoot genesis |
| `finality` | no | when finality is enabled |
| `migration-exit` (leaving IceRoot, and the migration records apps show) | no | when migration is enabled |
| `history-search` | limited to the reference API's routes | with the indexer |
| `live-events` (updates the network pushes) | no: watching polls the node | with the indexer |
| `transaction-id-before-signing` | no (ids hash the signed bytes) | from the post-quantum formats |

## Keys and recovery phrases

<!-- sample: verified 0.1.0 -->
```ts
import { Mnemonic } from "@iceroot-network/sdk";

const phrase = Mnemonic.generate();          // 24 English words from 256 bits of secure randomness
const check = Mnemonic.check(userInput);     // { ok, words, reason?, position? }: reason "empty" | "not-text" | "unknown-word" | "word-count" | "too-short" | "checksum"

const account = net.keys.fromPhrase(phrase, { account: 0, index: 0 });   // optional BIP39 passphrase: { passphrase }
account.address;     // the address on this network
account.publicKey;   // hex
account.algorithm;   // "secp256k1-bip340" today; "ml-dsa-65" from the post-quantum formats
account.release();   // wipes the key; the handle throws KeyReleased afterwards

const watched = net.keys.watch(address);                  // watch-only: { address, watchOnly: true }, no key
const legacy = net.keys.fromLegacyPassphrase(text);       // devnet profiles only; see below
```

- **New accounts** always come from a 24-word phrase. Import accepts 18, 21 or 24 words; fewer are refused with `PhraseTooShort`.
- **Derivation** is hardened only. On today's devnet the key is secp256k1 at `m/44'/1'/account'/0'/index'`. From the post-quantum formats the same phrase derives ML-DSA-65 keys through a different master key, so the same phrase gives unrelated classical and post-quantum keys. Apps keep one shape on every network: an account number and an address index.
- **Coin type** `1'` is used on devnets and the public testnet. Mainnet will use IceRoot's registered coin type, so one phrase never gives the same keys on a test network and on mainnet.
- **Legacy passphrase keys.** The devnet's funded test accounts and the browser wallet's existing devnet identities use the reference implementation's passphrase key (the SHA-256 of the text). `net.keys.fromLegacyPassphrase(text)` imports them, on devnet profiles only; the result has `legacy: true`. Offer it as an import, never as a way to create an account. It disappears with the devnet formats.
- **Secrets stay in WebAssembly memory.** JavaScript sees public keys, addresses and signatures only. A phrase is a string when it is typed, but the SDK also accepts it as a `Uint8Array`, which you can overwrite after use. Call `release()` as soon as signing is done.

### Contexts without network access

A Manifest V3 sandbox page, a signing worker or another device holds keys but has no network. It works from the profile alone. Static functions take the profile, or a connected network, as their last argument before options; a profile is a plain object, so the page that connected can hand `net.profile` to such a context with `postMessage`:

<!-- sample: verified 0.1.0 -->
```ts
import { Keys, Messages, profiles } from "@iceroot-network/sdk";

const profile = profiles.devnet({ relays: [relay], nethash: pinnedNethash });   // the relay is never contacted here
const account = Keys.fromPhrase(phrase, profile, { account: 0, index: 0 });
const signature = Messages.sign(account, message);
account.release();
```

## Addresses

<!-- sample: verified 0.1.0 -->
```ts
import { Address } from "@iceroot-network/sdk";

const address = Address.parse(text, net);   // throws InvalidAddress { reason: "checksum" | "length" | "wrong-network" | "format" }
const result = Address.check(text, net);    // { ok, reason?, position? } for form feedback
address.toString();
```

Addresses are always parsed against a network. On today's devnet an address is Base58Check with network byte 90 (34 characters, starting with `d`). From the IceRoot genesis addresses are Bech32m: `ice1...` on mainnet, `tice1...` on every other network. A devnet address is refused on another network with `wrong-network`. Never check an address with a regular expression.

## Amounts and assets

<!-- sample: verified 0.1.0 -->
```ts
import { Amount, AssetId } from "@iceroot-network/sdk";

const units = Amount.parse("1.5", net.token.decimals);    // 150000000n today; refuses more fraction digits than decimals
Amount.format(units, net.token.decimals);                  // "1.5"
Amount.format(units, net.token.decimals, { maxFraction: 2, grouping: true });
AssetId.ROOT;                                               // the ROOT asset id
```

- Amounts are `bigint` base units in every call and result. No SDK function takes or returns a floating-point amount or share.
- An asset is identified by its asset id, never by its symbol. Today's devnet has one asset, ROOT, with 8 decimals. From the IceRoot genesis ROOT has 18 decimals and other assets exist.
- `JSON.stringify` cannot write a `bigint`. When an amount crosses a JSON boundary (an API response, `postMessage` to a page that does not use the SDK), send it as a decimal string of base units and parse it back with `BigInt(text)`.

## Reading from the network

All reads are methods of `net`, return typed records and throw on failure. An unavailable node is an error, never an empty list. A lookup that finds nothing returns `null`.

<!-- sample: verified 0.1.0 -->
```ts
import { balanceOf } from "@iceroot-network/sdk";

const status = await net.node.status();                  // { height, synced, blocksBehind, chainTime }
const info = await net.accounts.get(address);            // an address the chain has never seen is an empty account
balanceOf(info);                                         // bigint base units of ROOT; info.balances lists each asset
info.nonce;                                              // bigint
info.vote;                                               // [{ validator, basisPoints }], empty when not voting
info.validatorName;                                      // the validator name if the account is a registered validator, else undefined

const page = await net.history.forAccount(address, { direction: "all", page: 1, limit: 25 });
page.items;                                              // TxRecord[], each with its direction relative to the account
page.hasNext;                                            // and page.total, page.pageCount

const tx = await net.transactions.get(id);               // TxRecord, also found while still in the pool; null when unknown
const recent = await net.transactions.list({ kind: "transfer", page: 1, limit: 25 });   // newest first; filters by sender, recipient, kind and block
const latest = await net.blocks.latest();                // BlockInfo: { id, height, time, producerName, transactionCount, ... }
const block = await net.blocks.get(heightOrId);          // a height (number or bigint) or an id; null when not found
const txs = await net.blocks.transactions(heightOrId);
const missed = await net.blocks.missed({ page: 1, limit: 50 });   // recent missed slots: height, time, validator

const validators = await net.validators.list();          // a page of ValidatorInfo in rank order, up to 100 per page
const one = await net.validators.get(nameOrAddress);
const voters = await net.validators.voters(validatorName);
const produced = await net.validators.blocks(validatorName);
const missedBy = await net.validators.missed(validatorName);

const round = await net.rounds.validators(roundNumber); // the validators seated in a round
const named = await net.names.resolve(validatorName);    // today: validator names only
const fees = await net.fees.statistics();                // the node's fee figures, for display
```

Live updates:

<!-- sample: verified 0.1.0 -->
```ts
const stop = net.watch({ address }, (event) => {
  if (event.type === "block") console.log(`block ${event.block.height}`);           // the node's latest block
  if (event.type === "transaction") console.log(`new: ${event.transaction.id}`);    // a new transaction of the address, in a block
  if (event.type === "error") console.warn("the node did not answer", event.error); // one poll failed; the watch goes on
});
stop();   // or pass { signal } as the third argument and abort it
```

The network pushes no events yet, so `net.watch` polls the node once a block time (`{ intervalMs }` changes that). Each time the height moves it reports the latest block and, with an address (or a watch-only account from `net.keys.watch`), each transaction of that address that is new in a block since the watch began, oldest first. A failed poll is an `error` event, never an empty update. Polling has two limits:

- **One block per poll.** Blocks produced between two polls are not listed; read them with `net.blocks.list()`.
- **At most 50 new transactions per poll and address.** A poll reads the newest 50 of the address's history; when more arrive between two polls, the older ones are not reported. An address that receives in bulk (an exchange's deposit address, for example) reads `net.history.forAccount` page by page instead, or polls more often with `{ intervalMs }`.

Record shapes used in the guides (the full types are exported: `TxRecord`, `ValidatorInfo`, `AccountInfo`, `BlockInfo` and the rest). Amounts, nonces, heights and lifetime counters are `bigint`; an absent value is a missing property:

<!-- sample: verified 0.1.0 -->
```ts
type TxRecord = {
  id: string;
  status: "pending" | "confirmed";
  block?: { id: string; height: bigint; confirmations: bigint; time?: { chain: bigint; unix: bigint } };   // absent while pending
  direction?: "sent" | "received" | "to-self" | "other";   // in a history: relative to the account asked about
  sender: string;
  senderPublicKey: string;
  nonce: bigint;
  fee: bigint;
  burnedFee?: bigint;
  memo?: string;
  secondSigned: boolean;
  version: number;
  details:
    | { kind: "transfer"; recipients: { address: string; amount: bigint }[] }   // 1 to 256 recipients
    | { kind: "vote"; entries: { validator: string; basisPoints: number }[] }    // empty withdraws the vote
    | { kind: "burn"; amount: bigint }
    | { kind: "register-second-key"; publicKey: string }
    | { kind: "register-validator"; name: string }
    | { kind: "resign-validator"; resignation: "temporary" | "permanent" | "revoke" }
    | { kind: "other"; typeGroup: number; typeId: number; assetJson?: string };
};

type ValidatorInfo = {
  name: string;
  address: string;
  publicKey: string;
  rank?: number;                                   // absent when not ranked
  status: "active" | "standby" | "resigned-temporary" | "resigned-permanent";
  voteWeight: bigint;                              // base units
  voteShareBasisPoints: number;                    // share of the supply, in basis points, rounded by the node
  voters: bigint;
  production: {                                    // lifetime counters today
    produced: bigint;
    missed: bigint;
    productivityBasisPoints?: number;
    lastBlock?: { id: string; height?: bigint; time?: { chain: bigint; unix: bigint } };
  };
  earnings: { rewards: bigint; fees: bigint; burnedFees: bigint; donations: bigint; total: bigint };
  version?: string;
};
```

Times are `{ chain, unix }`: seconds since the chain's epoch and since the Unix epoch. Show a time with `new Date(Number(time.unix) * 1000)`.

Profile texts of validators (tagline, website, location) are not chain data. The SDK does not fetch them; they come from the validators portal.

### Limits of today's devnet API

The reference implementation's API allows about 100 requests per minute per client address. The SDK spends a request budget before each request (waiting when it is spent), retries HTTP 429 with backoff (2 seconds, doubling, three retries), and reports `RateLimited` when the node keeps refusing. Design screens to read once and refresh on a timer or on new blocks, not per row: for example read `validators.list()` once, not `validators.get(name)` for each validator.

## Transactions: build, review, sign, submit, follow

A build call resolves everything online (nonce, fee, the rules in force) and returns a draft. Signing is a separate step, so the review screen shows exactly what will be signed.

<!-- sample: verified 0.1.0 -->
```ts
import { Address, Amount } from "@iceroot-network/sdk";

const draft = await net.build.transfer({
  from: account,                      // the sender's Account, or its public key
  to: [{ address: Address.parse(recipient, net), amount: Amount.parse("2.5", net.token.decimals) }],   // 1 to 256
  memo: "invoice 42",                 // at most net.rules.memo.maxBytes UTF-8 bytes
  fee: "minimum",                     // the default: the exact floor; or a bigint, or { multiplierBasisPoints }
});

draft.fee;        // bigint: show this, never a constant
draft.nonce;      // bigint
draft.size;       // bytes, with the signatures it will carry
draft.summary;    // what the review screen shows: { kind, from, total, lines, ... }, lines being readable text such as each recipient and amount

const signed = draft.sign(account);                       // pass { secondKey } when the account has one
signed.id;                                                // known after signing on today's devnet
const result = await net.submit(signed);                  // { id, status: "accepted", broadcast } or { id, status: "rejected", reason, nodeCode, message }
if (result.status === "rejected") showRefusal(result.reason);

const outcome = await net.transactions.wait(signed.id, { until: "confirmed", timeoutMs: 60_000 });
// outcome.state: "confirmed" (with outcome.confirmations and outcome.record) or "dropped"; throws Timeout when the time runs out
```

Other builders:

<!-- sample: verified 0.1.0 -->
```ts
await net.build.vote({ from, entries: [{ validator: "bergschrund", basisPoints: 500 }, /* ... */] });
await net.build.vote({ from, entries: [] });                           // withdraws the current vote
await net.build.burn({ from, amount });
await net.build.registerSecondKey({ from, secondKey: secondAccount.publicKey });   // or the Account itself
await net.build.registerValidator({ from, name: "bergschrund" });      // the surcharge is in draft.fee
await net.build.resignValidator({ from, resignation: "temporary" });   // "temporary", "permanent" or "revoke"
```

- **Online facts.** Each builder reads the sender's account (for its nonce and second key) and the node's status (for the next block's height), and refuses with `WrongKey` when the node knows another public key for the sender's address. The draft is checked against the rules of that next block.
- **Votes** name validators by their name. Entries are whole basis points summing to `net.rules.vote.totalBasisPoints`. The builder checks `net.rules.vote` and throws `InvalidVote` with the problem in `details`.
- **Fees.** `fee: "minimum"` is the exact floor, computed by Heartwood Core's own function from the transaction's size and the milestone in force at the next block (`draft.summary.fee.source` is `floor`); burns and resignations have a floor of zero. Surcharges (validator registration, and later names and reward-sharing declarations) are part of the floor. A node admits a transaction to its pool by the same rule whenever the milestone enables dynamic fees, as today's devnet does, and `net.configuration.poolFees` then reports the milestone's figures. On a network whose milestone has no enabled dynamic fees, a node admits by its own pool settings (or by a fixed fee) instead, which the SDK cannot know: there is no floor (`net.rules.fees.floorAvailable` is `false`, `draft.summary.fee.floor` is absent), `"minimum"` and `{ multiplierBasisPoints }` throw `FeeUnavailable`, and an app passes an exact `bigint` fee. `{ multiplierBasisPoints }` pays a multiple of the floor. A draft's fee never comes from `net.fees.statistics()`, which is for display only. Show `draft.fee` on the review screen; never a constant.
- **Submission.** `net.submit(signed)` sends one transaction; `net.submitAll(list)` sends several in as few requests as the pool allows (`net.configuration.pool.maxTransactionsPerRequest` per request), refuses a transaction larger than `maxTransactionBytes` with reason `too-large` without sending it, and reports one outcome per transaction in order. If a request fails midway, the error is thrown and earlier requests may have reached the pool: look their transactions up before sending them again.
- **Refusals.** `result.reason` is one of `low-fee`, `nonce`, `balance`, `duplicate`, `invalid`, `pool-full`, `wrong-network`, `too-large`, `other`; `result.nodeCode` keeps the node's own code (for example `ERR_LOW_FEE`).
- **Stale drafts.** A draft records the height and the nonce it was built for. If the account sent another transaction in the meantime, the node refuses the draft's transaction with reason `nonce`: build again and show the new review.
- **Waiting.** `net.transactions.wait` polls the chain and the pool every half block. It ends with `confirmed` once the transaction is in a block with the confirmations asked for (`confirmations`, 1 by default), with `dropped` when it has been in neither for `droppedAfterMs` (three block times by default), and throws `Timeout` after `timeoutMs`. `onProgress` reports each poll, and `signal` cancels.
- **Finality.** Today's devnet has no finality, so `until: "final"` throws `UnsupportedOnNetwork`. Show confirmations and "not final" wording; never call a transaction final. When `net.capabilities.has("finality")` becomes true, credit and complete claims only on `state: "final"`.

### Drafts that travel

A draft is built where the network is and signed where the key is: a Manifest V3 sandbox page, the native Tauri plugin, another device. Drafts and signed transactions serialize to bytes:

<!-- sample: verified 0.1.0 -->
```ts
import { Draft, SignedTransaction } from "@iceroot-network/sdk";

// Where the network is:
const draftBytes = draft.serialize();            // Uint8Array: unsigned fields, fee, nonce, network identity, height

// Where the key is:
const again = Draft.deserialize(draftBytes, profile);   // refuses a draft for another network
showForApproval(again.summary);                          // recomputed from the fields, not taken from the sender
const signedBytes = again.sign(account).serialize();

// Back where the network is:
const signedTx = SignedTransaction.deserialize(signedBytes, net.profile);
await net.submit(signedTx);
```

The summary comes from the transaction's own bytes: the operation, the recipients and amounts, the nonce, the fee and the memo are exactly what will be signed. The fee's source (`floor`) and the token symbol in the review lines come from the network configuration that travels with the draft; the pinned network hash identifies the chain but does not cover that configuration. A signing context that does not trust the context that built the draft judges the fee by its amount, not by its source.

## Messages and sign-in

<!-- sample: verified 0.1.0 -->
```ts
import { Messages, SignIn, messageAlgorithmOf, messageNetworkOf } from "@iceroot-network/sdk";

const signature = net.messages.sign(account, text);
// { publicKey, signature, algorithm: "secp256k1-bip340-sha256", network: "heartwood-devnet-v90" } today

Messages.verify({ message: text, ...signature }, net);   // true or false; with a profile or network, the signature must name it

messageNetworkOf(net);     // "heartwood-devnet-v90" today: the network name every message signature carries
messageAlgorithmOf(net);   // "secp256k1-bip340-sha256" today

// A wallet, before it asks the holder to sign a website's sign-in message:
const fields = SignIn.parse(message, net, { origin: senderOrigin, address, publicKey, now: new Date() });
// throws with the reason unless: the format is version 1, the origin is secure and equals the sender,
// the URI is origin + "/login", the network, public key and address are the selected identity's,
// the nonce is 64 hex characters and the times are valid and at most five minutes apart.
// Every expected field is required (a missing one throws InvalidArgument); a context that knows only
// the public key derives the address with Address.fromPublicKey(publicKey, profile).

// A server that issues sign-in challenges:
const challenge = SignIn.build({ origin, publicKey, nonce, issuedAt, expiresAt }, net);   // the network and address come from the profile and the key
```

- On today's devnet a message signature is BIP340 over the SHA-256 of the exact UTF-8 message, which is the format the browser wallet and the validators portal already use. The SDK always hashes first, so a message of exactly 32 bytes is handled like any other.
- In today's format a transaction is signed the same way, over the SHA-256 of its unsigned bytes, so a message signature over those bytes would be a valid signature of the transaction. Every transaction begins with the byte 0xff and no UTF-8 text does: `Messages.sign` refuses a message given as bytes that begin with 0xff with `InvalidArgument` (reason `transaction-header`), and `Messages.verify` returns false for one. From the post-quantum formats on, a message signature carries a signing domain of its own.
- `messageNetworkOf` and `messageAlgorithmOf` give the identifiers of a profile's message format without signing anything. A wallet's `connect` answer and a server's challenge use them.
- A signature's `network` and `algorithm` are labels next to it: the signature covers the message only. A protocol that must bind a message to one network names the network in the message's text, as the sign-in message does.
- A wallet never signs a transaction for a website, and signs for a website only a message it shows the holder as text. A website provider offers `connect` and `signMessage` only, takes the message as text, never as bytes or hex, and the wallet runs `SignIn.parse` before it asks the holder.

## Errors

Every SDK error is an `IceRootError` with a stable `code`, a readable `message` and structured `details`. Subclasses exist for `instanceof` checks. The codes are part of the API.

| Group | Codes |
|---|---|
| Input | `InvalidPhrase`, `PhraseTooShort`, `InvalidPath`, `InvalidAddress`, `InvalidKey`, `InvalidAmount`, `MemoTooLong`, `NoRecipients`, `TooManyRecipients`, `InvalidVote`, `InvalidName`, `InvalidFee`, `InvalidDraft`, `InvalidTransaction`, `InvalidSignIn`, `InvalidRequest`, `InvalidProfile`, `InvalidArgument` |
| Network | `NodeUnavailable`, `RateLimited`, `Timeout`, `BadResponse`, `NotFound`, `Refused`, `NetworkMismatch` |
| Submission | `TxRejected` (with `reason` and `nodeCode`), `StaleDraft`, `FeeUnavailable` (no fee floor in force: pass an exact fee) |
| Support | `UnsupportedOnNetwork` (with `capability`), `SdkNotInitialized`, `WasmLoadFailed` |
| Crypto | `RandomnessUnavailable`, `SigningFailed`, `WrongKey`, `KeyReleased` |
| Vote selection | `InvalidPickCount`, `ValidatorCannotVote`, `InvalidSnapshot`, `NotEnoughValidators`, `DoesNotFit`, `BreaksRules`; classes in `@iceroot-network/sdk/vote` ([Vote selection](vote.md#errors)) |
| Ownership proofs | `InvalidProof` (with `reason`); class in `@iceroot-network/sdk/ownership` ([Ownership proofs](ownership.md#errors)) |
| Keystore | `WrongPasswordOrCorrupt`, `Malformed`, `UnsupportedVersion`, `UnsupportedKdf`, `UnsupportedPayload`, `ParamsOutOfRange`, `InvalidPayload`, `InvalidPassword`, `OutOfMemory`; classes in `@iceroot-network/sdk/keystore` ([Keystore](keystore.md#errors)) |

<!-- sample: verified 0.1.0 -->
```ts
import { IceRootError } from "@iceroot-network/sdk";

try {
  await net.accounts.get(address);
} catch (error) {
  if (error instanceof IceRootError && error.code === "NodeUnavailable") {
    showRetry("The network is unavailable. Try again in a moment.");   // never show sample or cached data as current
  } else {
    throw error;
  }
}
```

## Names these pages depend on

Every SDK name a sample uses is listed in the sample's `needs`. `node scripts/check-docs.mjs --needs` prints the full list with the pages that use each name, which is the list to check against the generated API reference of a release.
