# Concepts

The whole API in one page. The quickstarts and integration guides use only what is described here. Names are the TypeScript ones; the Rust crates use the same names in snake case.

## Loading the module

The SDK is WebAssembly. It must be loaded once before any other call.

<!-- sample: pending; needs: init, initSync -->
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

<!-- sample: pending; needs: connect, profiles.devnet, net.profile, transport-option, connect-headers -->
```ts
import { connect, profiles } from "@iceroot-network/sdk";

const profile = profiles.devnet({
  relays: ["http://127.0.0.1:6003/api"],   // include the API base path
  nethash: savedNethash,                    // optional: the identity pinned on first contact
});
const net = await connect(profile, {
  transport: fetch,                         // optional; default globalThis.fetch
  headers: { authorization: `Bearer ${token}` },   // optional; for a relay behind a proxy that needs a token
});

const pinned = net.profile.chain.nethash;   // store this; pass it as `nethash` next time
```

- **One chain per profile.** A devnet is pinned on first contact: the node's network identity (the nethash on today's devnet) is recorded, and a later connection that finds another identity throws `NetworkMismatch`. The app may pin again only after asking the holder, because a changed identity means a different chain (for example a devnet that was reset).
- **Relays.** Reads go to the first healthy relay; submissions may go to several. The URL includes the API base path; the SDK appends route paths to it and never guesses the base path.
- **Transport.** Any function with the signature of `fetch`. Tauri apps pass the HTTP plugin's `fetch` so requests leave from Rust (see the [Tauri quickstart](quickstart/tauri.md)).
- **Headers.** A hosted devnet endpoint that needs a token takes it as a request header, passed in `headers` (see [Devnet](devnet.md)); the token is never part of the profile.
- **Built-in profiles.** Release 0.1.0 has `profiles.devnet(options)` only. Profiles for the public testnet and mainnet are added in the releases made when those chains' geneses are fixed; until then they do not exist, so no app can point at a guessed identity. Show them in a network selector as not yet available.

### What `net` tells you about the network

<!-- sample: pending; needs: net.stage, net.token, net.rules, net.economics, net.capabilities -->
```ts
net.stage;          // "s1" on today's devnet (the Solar-compatible formats); later "pq", then "id"
net.token;          // { assetId, symbol: "ROOT", decimals }: 8 decimals today, 18 from the IceRoot genesis
net.rules;          // vote, transfer, memo, name, burn and fee rules in force at the next block
net.economics;      // seats, block time, reward per rank, donations, fee burn share
net.capabilities.has("finality");   // false today
```

Never copy these values into constants. `net.rules` and `net.economics` follow the chain's milestones, and they differ between today's devnet and the IceRoot networks.

Rule fields used in these guides:

<!-- sample: pending; needs: net.rules.vote, net.rules.transfer, net.rules.memo -->
```ts
net.rules.vote.minEntries;          // 1 today; 20 from the IceRoot genesis
net.rules.vote.maxEntries;          // 53
net.rules.vote.maxShareBasisPoints; // null today (no per-validator cap); 500 from the IceRoot genesis
net.rules.vote.totalBasisPoints;    // 10000
net.rules.vote.maxBytes;            // 1024 today; 1280 from the IceRoot genesis
net.rules.transfer.maxRecipients;   // 256
net.rules.memo.maxBytes;            // 255 (UTF-8 bytes, not characters)
```

`net.economics` serves displays and estimates, such as the portal's rewards calculator; nothing in it is signed:

<!-- sample: pending; needs: net.economics, net.economics.supply -->
```ts
net.economics.seats;                // active validators per round (53)
net.economics.blockTimeSeconds;     // 8
net.economics.rewardsByRank;        // block reward in base units for each seated rank
net.economics.donations;            // [{ address, basisPoints }]
net.economics.feeBurnBasisPoints;   // share of each fee that is burned
const supply = await net.economics.supply();   // { issued, burned, current } in base units, from the node
```

### Capabilities

Every network declares what it supports. An operation the network lacks throws `UnsupportedOnNetwork` with the capability's name; apps hide the feature instead of letting the error happen.

| Capability | Today's devnet | Later |
|---|---|---|
| `transfer`, `burn`, `vote`, `validator-registration`, `second-key`, `message-signing` | yes | yes |
| `validator-names` (resolve a validator by its name) | yes | yes |
| `key-rotation`, `multisig` | no | from the post-quantum formats |
| `names` (register, resolve and send to account names) | no | from the IceRoot genesis |
| `share-declare` (declared reward sharing) | no | from the IceRoot genesis |
| `assets`, `swaps`, `htlc`, `time-locks` | no | after the IceRoot genesis |
| `finality` | no | when finality is enabled |
| `migration-exit` (leaving IceRoot, and the migration records apps show) | no | when migration is enabled |
| `history-search` | limited to the reference API's routes | with the indexer |
| `live-events` | no (the SDK polls) | with the indexer |
| `transaction-id-before-signing` | no (ids hash the signed bytes) | from the post-quantum formats |

## Keys and recovery phrases

<!-- sample: pending; needs: Mnemonic.generate, Mnemonic.check, net.keys.fromPhrase, net.keys.watch, net.keys.fromLegacyPassphrase, account.release -->
```ts
import { Mnemonic } from "@iceroot-network/sdk";

const phrase = Mnemonic.generate();          // 24 English words from 256 bits of secure randomness
const check = Mnemonic.check(userInput);     // { ok, words, error?: "checksum" | "unknown-word" | "too-short" | ... }

const account = net.keys.fromPhrase(phrase, { account: 0, index: 0 });   // optional BIP39 passphrase: { passphrase }
account.address;     // the address on this network
account.publicKey;   // hex
account.algorithm;   // "secp256k1-bip340" today; "ml-dsa-65" from the post-quantum formats
account.release();   // wipes the key; the handle throws KeyReleased afterwards

const watched = net.keys.watch(address);                  // watch-only: no key
const legacy = net.keys.fromLegacyPassphrase(text);       // devnet profiles only; see below
```

- **New accounts** always come from a 24-word phrase. Import accepts 18, 21 or 24 words; fewer are refused with `PhraseTooShort`.
- **Derivation** is hardened only. On today's devnet the key is secp256k1 at `m/44'/1'/account'/0'/index'`. From the post-quantum formats the same phrase derives ML-DSA-65 keys through a different master key, so the same phrase gives unrelated classical and post-quantum keys. Apps keep one shape on every network: an account number and an address index.
- **Coin type** `1'` is used on devnets and the public testnet. Mainnet will use IceRoot's registered coin type, so one phrase never gives the same keys on a test network and on mainnet.
- **Legacy passphrase keys.** The devnet's funded test accounts and the browser wallet's existing devnet identities use the reference implementation's passphrase key (the SHA-256 of the text). `net.keys.fromLegacyPassphrase(text)` imports them, on devnet profiles only; the result has `legacy: true`. Offer it as an import, never as a way to create an account. It disappears with the devnet formats.
- **Secrets stay in WebAssembly memory.** JavaScript sees public keys, addresses and signatures only. A phrase is a string when it is typed, but the SDK also accepts it as a `Uint8Array`, which you can overwrite after use. Call `release()` as soon as signing is done; handles also support `using` (`Symbol.dispose`).

### Contexts without network access

A Manifest V3 sandbox page, a signing worker or another device holds keys but has no network. It works from the profile alone. Static functions take the profile, or a connected network, as their last argument before options; a profile is a plain object, so the page that connected can hand `net.profile` to such a context with `postMessage`:

<!-- sample: pending; needs: Keys.fromPhrase, Keys.fromLegacyPassphrase, Messages.sign, offline-profile -->
```ts
import { Keys, Messages, profiles } from "@iceroot-network/sdk";

const profile = profiles.devnet({ relays: [relay], nethash: pinnedNethash });   // the relay is never contacted here
const account = Keys.fromPhrase(phrase, profile, { account: 0, index: 0 });
const signature = Messages.sign(account, message);
account.release();
```

## Addresses

<!-- sample: pending; needs: Address.parse, Address.check -->
```ts
import { Address } from "@iceroot-network/sdk";

const address = Address.parse(text, net);   // throws InvalidAddress { reason: "checksum" | "length" | "wrong-network" | "format" }
const result = Address.check(text, net);    // { ok, reason?, position? } for form feedback
address.toString();
```

Addresses are always parsed against a network. On today's devnet an address is Base58Check with network byte 90 (34 characters, starting with `d`). From the IceRoot genesis addresses are Bech32m: `ice1...` on mainnet, `tice1...` on every other network. A devnet address is refused on another network with `wrong-network`. Never check an address with a regular expression.

## Amounts and assets

<!-- sample: pending; needs: Amount.parse, Amount.format, AssetId.ROOT -->
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

All reads are methods of `net`, return typed records and throw on failure. An unavailable node is an error, never an empty list.

<!-- sample: pending; needs: net.node.status, net.accounts.get, net.history.forAccount, net.transactions.get, net.transactions.list, net.blocks.latest, net.blocks.get, net.blocks.transactions, net.blocks.missed, net.validators.list, net.validators.missed, net.rounds.validators, net.names.resolve, net.fees.statistics, net.watch -->
```ts
const status = await net.node.status();                  // { height, synced, ... }
const info = await net.accounts.get(address);
info.balances.get(net.token.assetId);                    // bigint base units
info.nonce;                                              // bigint
info.vote;                                               // [{ validator, basisPoints }], empty when not voting
info.validator;                                          // the validator name if the account is a registered validator, else null

const page = await net.history.forAccount(address, { direction: "all", page: 1, limit: 25 });
page.items;                                              // TxRecord[]
page.hasMore;

const tx = await net.transactions.get(id);               // TxRecord, also found while still in the pool
const recent = await net.transactions.list({ page: 1, limit: 25 });   // newest first; filters by account and kind
const latest = await net.blocks.latest();                 // { height, id, timestamp, generator, transactionCount, ... }
const block = await net.blocks.get(heightOrId);
const txs = await net.blocks.transactions(block.id);
const missed = await net.blocks.missed({ page: 1, limit: 50 });   // recent missed slots: height, time, validator

const validators = await net.validators.list();          // ValidatorInfo[] in rank order
const one = await net.validators.get(nameOrAddress);
const voters = await net.validators.voters(name);
const produced = await net.validators.blocks(name);
const missedBy = await net.validators.missed(name);

const round = await net.rounds.validators(roundNumber); // the validators seated in a round
const named = await net.names.resolve(name);             // today: validator names only
const fees = await net.fees.statistics();                // the node's fee figures, for display
const stop = net.watch({ address }, (event) => { /* new block or transaction for this address */ });
```

Record shapes used in the guides:

<!-- sample: pending; needs: TxRecord, ValidatorInfo -->
```ts
type TxRecord = {
  id: string;
  kind: "transfer" | "vote" | "burn" | "second-key" | "validator-registration" | "validator-resignation";
  direction: "incoming" | "outgoing" | "self" | "none";   // relative to the account asked about
  status: "pending" | "confirmed";
  sender: string;
  transfers: { address: string; amount: bigint }[];      // a transfer's recipients (1 to 256)
  vote?: { validator: string; basisPoints: number }[];   // a vote's entries; empty withdraws
  fee: bigint;
  memo: string;
  height: bigint | null;                                   // null while pending
  timestamp: string | null;                                // block time, ISO 8601 UTC
  confirmations: number;
};

type ValidatorInfo = {
  name: string;
  address: string;
  rank: number | null;                                     // null when resigned
  status: "active" | "standby" | "resigned-temporary" | "resigned-permanent";
  voteWeight: bigint;                                      // base units
  voteWeightBasisPoints: number;                           // share of supply, in basis points
  voters: number;
  production: { forged: number; missed: number };          // lifetime counters today
};
```

Profile texts of validators (tagline, website, location) are not chain data. The SDK does not fetch them; they come from the validators portal.

### Limits of today's devnet API

The reference implementation's API allows about 100 requests per minute per client address. The SDK keeps a request budget, retries HTTP 429 with backoff, and reports `RateLimited` when the budget runs out. Design screens to read once and refresh on a timer or on new blocks, not per row: for example read `validators.list()` once, not `validators.get(name)` for each validator.

## Transactions: build, review, sign, submit, follow

A build call resolves everything online (nonce, fee, the rules in force) and returns a draft. Signing is a separate step, so the review screen shows exactly what will be signed.

<!-- sample: pending; needs: net.build.transfer, fee-floor, draft.summary, draft.sign, net.submit, net.transactions.wait, Address.parse, Amount.parse -->
```ts
import { Address, Amount } from "@iceroot-network/sdk";

const draft = await net.build.transfer({
  from: account.address,
  to: [{ address: Address.parse(recipient, net), amount: Amount.parse("2.5", net.token.decimals) }],   // 1 to 256
  memo: "invoice 42",                 // at most net.rules.memo.maxBytes UTF-8 bytes
  fee: "minimum",                     // the default: the exact floor; or a bigint, or { multiplier }
});

draft.fee;        // bigint: show this, never a constant
draft.nonce;      // bigint
draft.size;       // bytes, with the signatures it will carry
draft.summary;    // what the review screen shows: { kind, from, total, lines }, lines being readable text such as each recipient and amount

const signed = draft.sign(account);                       // pass { secondKey } when the account has one
signed.id;                                                // known after signing on today's devnet
const result = await net.submit(signed);                  // { status: "accepted" } or { status: "rejected", reason, nodeCode }
if (result.status === "rejected") showRefusal(result.reason);

const status = await net.transactions.wait(signed.id, { until: "confirmed", timeoutMs: 60_000 });
// status.state: "pending" | "confirmed" | "final" | "rejected" | "dropped"; status.confirmations
```

Other builders:

<!-- sample: pending; needs: net.build.vote, net.build.burn, net.build.registerSecondKey, net.build.registerValidator, net.build.resignValidator, fee-floor -->
```ts
await net.build.vote({ from, entries: [{ validator: "bergschrund", basisPoints: 500 }, /* ... */] });
await net.build.vote({ from, entries: [] });                           // withdraws the current vote
await net.build.burn({ from, amount });
await net.build.registerSecondKey({ from, secondKey: secondAccount.publicKey });
await net.build.registerValidator({ from, name: "bergschrund" });      // the surcharge is in draft.fee
await net.build.resignValidator({ from, kind: "temporary" });          // "temporary", "permanent" or "revoke"
```

- **Votes** name validators by their name. Entries are whole basis points summing to `net.rules.vote.totalBasisPoints`. The builder checks `net.rules.vote` and throws `InvalidVote` with the problem in `details`.
- **Fees.** `fee: "minimum"` is the exact floor the node accepts, computed from the transaction's size and the milestone in force, and never below the node's pool minimum. Surcharges (validator registration, and later names and reward-sharing declarations) are part of the floor. Show `draft.fee` on the review screen; never a constant.
- **Refusals.** `result.reason` is one of `low-fee`, `nonce`, `balance`, `duplicate`, `invalid`, `pool-full`, `wrong-network`, `too-large`, `other`; `result.nodeCode` keeps the node's own code (for example `ERR_LOW_FEE`).
- **Stale drafts.** A draft records the height it was built for. If the nonce, the fee floor or the milestone changed before submission, `net.submit` throws `StaleDraft`: build again and show the new review.
- **Finality.** Today's devnet has no finality, so `until: "final"` throws `UnsupportedOnNetwork`. Show confirmations and "not final" wording; never call a transaction final. When `net.capabilities.has("finality")` becomes true, credit and complete claims only on `state: "final"`.

### Drafts that travel

A draft is built where the network is and signed where the key is: a Manifest V3 sandbox page, the native Tauri plugin, another device. Drafts and signed transactions serialize to bytes:

<!-- sample: pending; needs: draft.serialize, Draft.deserialize, signed.serialize, SignedTransaction.deserialize -->
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

## Messages and sign-in

<!-- sample: pending; needs: net.messages.sign, Messages.verify, SignIn.parse, SignIn.build, messageNetworkOf, messageAlgorithmOf -->
```ts
import { Messages, SignIn, messageAlgorithmOf, messageNetworkOf } from "@iceroot-network/sdk";

const signature = net.messages.sign(account, text);
// { publicKey, signature, algorithm: "secp256k1-bip340-sha256", network: "heartwood-devnet-v90" } today

Messages.verify({ message: text, ...signature }, net);   // true or false; with a profile or network, the signature must name it

messageNetworkOf(net);     // "heartwood-devnet-v90" today: the network name every message signature carries
messageAlgorithmOf(net);   // "secp256k1-bip340-sha256" today

// A wallet, before it asks the holder to sign a website's sign-in message:
const fields = SignIn.parse(message, { origin: senderOrigin, address, publicKey, now: new Date() });
// throws with the reason unless: the format is version 1, the origin is secure and equals the sender,
// the URI is origin + "/login", the network, public key and address are the selected identity's,
// the nonce is 64 hex characters and the times are valid and at most five minutes apart.
// Every expected field is required; a context that knows only the public key derives the address
// with Address.fromPublicKey(publicKey, profile).

// A server that issues sign-in challenges:
const challenge = SignIn.build({ origin, network, publicKey, address, nonce, issuedAt, expiresAt });
```

- On today's devnet a message signature is BIP340 over the SHA-256 of the exact UTF-8 message, which is the format the browser wallet and the validators portal already use. The SDK always hashes first, so a message of exactly 32 bytes is handled like any other.
- `messageNetworkOf` and `messageAlgorithmOf` give the identifiers of a profile's message format without signing anything. A wallet's `connect` answer and a server's challenge use them.
- There is no SDK function that signs a transaction for a website. A website provider offers `connect` and `signMessage` only, and the wallet runs `SignIn.parse` before it asks the holder.

## Errors

Every SDK error is an `IceRootError` with a stable `code`, a readable `message` and structured `details`. Subclasses exist for `instanceof` checks. The codes are part of the API.

| Group | Codes |
|---|---|
| Input | `InvalidPhrase`, `PhraseTooShort`, `InvalidPath`, `InvalidAddress`, `InvalidKey`, `InvalidAmount`, `MemoTooLong`, `NoRecipients`, `TooManyRecipients`, `InvalidVote`, `InvalidName`, `InvalidFee`, `InvalidDraft`, `InvalidTransaction`, `InvalidSignIn` |
| Network | `NodeUnavailable`, `RateLimited`, `Timeout`, `BadResponse`, `NetworkMismatch` |
| Submission | `TxRejected` (with `reason` and `nodeCode`), `StaleDraft`, `FeeUnavailable` |
| Support | `UnsupportedOnNetwork` (with `capability`), `SdkNotInitialized`, `WasmLoadFailed` |
| Crypto | `RandomnessUnavailable`, `SigningFailed`, `WrongKey`, `KeyReleased` |

<!-- sample: pending; needs: IceRootError, error-codes -->
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
