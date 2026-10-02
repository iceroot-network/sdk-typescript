# Integration guide: mobile wallet

The mobile wallet (`iceroot-network/mobile-wallet`) is one Vite, React 19 and Tauri 2 app for Android (minimum SDK 24) and iOS 15. Today its domain layer, `src/domain/wallet.ts`, reads `public/mock-test-api.json` and applies transfers and votes to that sample in memory.

The app's architecture document requires a reviewed native key vault before any create or import control exists. The SDK's native Tauri plugin, `tauri-plugin-iceroot`, is that boundary: keys are derived, held and used in Rust, the page holds opaque handles, recovery phrases are kept only as [keystores](../keystore.md) encrypted natively with the mobile preset, and every request to the node leaves from Rust. The wallet registers the plugin and imports `@iceroot-network/sdk/tauri`.

Read first: [Concepts](../concepts.md), [Rules](../rules.md), [Tauri quickstart](../quickstart/tauri.md), [Devnet](../devnet.md). The [Tauri example](../../examples/tauri-plugin/README.md) is a working plugin app.

The desktop wallet (`iceroot-network/desktop-wallet`) is a worked example of the same flow on the WebAssembly entry, with the Tauri HTTP plugin as transport. Its modules carry over almost as they are, with `await` added where the plugin returns promises:

| Module | What it shows |
|---|---|
| `src/network.ts` | `connect` with the HTTP plugin's `fetch` inside Tauri and no transport outside it, and an optional `headers` for an endpoint's token (empty on the desktop, whose local relay needs none) |
| `src/walletData.ts` | The reads, and `safeText` for text that comes from the chain |
| `src/session.ts` | `Sender` and `senderOf`, the prepare functions that need no key, `reviewDraft`, `signDraft` and `submitSigned` |
| `src/keys.ts` | `deriveAccount` from a profile alone, and `openWallet` with its check of the saved address |
| `src/vote.ts`, `src/voteModes.ts` | The vote library, with the snapshot read once per visit |
| `src/lifecycle.ts`, `src/storage.ts` | Connecting, the pinned identity, the checks of stored settings, the lock |

## What to wire now and what waits

| Part | Release 0.1.0 | Waits for |
|---|---|---|
| The plugin, and the connection to the hosted devnet endpoint through it | Wire now | |
| Watch-only wallets: balances, activity, receive address with QR code | Wire now | |
| Validator directory | Wire now | |
| Create and import, with the phrase kept as a keystore (mobile preset) in the platform's secure storage | Wire now, after the architecture document's review of the plugin as the vault | |
| Signing and submitting transfers and votes | Wire now | |
| Vote modes with reasons | Wire now with the [vote library](../vote.md) (`@iceroot-network/sdk/tauri/vote`) | Indexer figures for Reliability, Maximum Rewards and Support Newcomers |
| Android and iOS builds | The plugin builds for Android (`aarch64-linux-android`) with the NDK | A first run on an Android device or emulator; an iOS build, which needs a macOS machine with Xcode |
| Names, assets other than ROOT, swaps, time locks, finality, migrations | Hide | The capabilities of later networks |

## The current sample-data layer

| File | Role today |
|---|---|
| `public/mock-test-api.json` | Sample data, schema version 2 (decimal strings): `wallets` (with `votes`), `assets`, `transactions`, `validators`, `contacts`, `snapshotAt`, `historyStartsAt` |
| `src/domain/types.ts` | `Wallet`, `Asset`, `Holding`, `Validator`, `Transaction` (status `simulated`, `pending` or `failed`), `VoteEntry = { validatorId, basisPoints }`, `TransferInput`, `TransferQuote`, `VoteQuote`, `MutationResult` |
| `src/domain/wallet.ts` | `loadDemoData` and `parseDemoData`; `formatAmount`; `prepareTransfer` and `submitTransfer`; `prepareVote` and `submitVote`; `splitVote`, `formatShare`; constants `ROOT_DECIMALS = 18`, `TRANSFER_FEE` and `VOTE_FEE` (0.1 ROOT), `VOTE_MIN_VALIDATORS = 20`, `VOTE_MAX_VALIDATORS = 53`, a 255-byte memo limit |
| `src/App.tsx` | Calls the domain functions from the tabs and the send and vote flows; the receive page shows an example address |
| `src-tauri/tauri.conf.json` | CSP `script-src 'self'`, `connect-src 'self' ipc: http://ipc.localhost`; `"capabilities": []` |
| `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` | A bare Tauri builder; no plugins |
| `docs/ARCHITECTURE.md` | The layers, and the rule that no key material goes into `localStorage` and that create and import wait for a native vault |

## Mapping: sample to SDK

| Sample | SDK | Notes |
|---|---|---|
| `loadDemoData`, `parseDemoData` | `connect` once, then the reads below | Keep `parseDemoData` only for a separate demo mode |
| `Wallet.address` | `account.address` of the wallet's keystore account, or `net.keys.watch(text)` for a watch-only wallet | |
| `Wallet.balance`, `assets[]` holdings | `net.accounts.get(address).balances` | `bigint`; format with `Amount.format` |
| `Wallet.votes` (`validatorId`) | `net.accounts.get(address).vote` (`validator`) | `validator` is the validator's name |
| `Asset` with `id: "root"`, 18 decimals | `net.token` | 8 decimals on today's devnet |
| `Transaction` list | `net.history.forAccount(address, { page, limit })` | Status `pending` or `confirmed`; `simulated` goes away |
| `Validator`: `name`, `rank`, `status`, `votingBalance`, `validatedBlocks` | `(await net.validators.list()).items`: `name`, `rank`, `status`, `voteWeight`, `production.produced` | `uptime` from `production` (lifetime counters today); `tagline` is not chain data |
| `formatAmount(decimalString)` | `Amount.format(units, decimals, { maxFraction, grouping: true })` | |
| `prepareTransfer` returning `TransferQuote` | `net.build.transfer(...)` returning a draft: `draft.fee`, `draft.summary` | Works without a key: build from the sender's public key (any account) or its address (once the account has sent a transaction); [step 3](#3-quotes-without-keys) |
| `submitTransfer` | `draft.sign(account)` (in the plugin, after the review), `net.submit`, `net.transactions.wait` | [Step 5](#5-keys-create-import-unlock-and-sign) |
| `prepareVote`, `submitVote` | `net.build.vote`, then sign and submit | |
| `splitVote` | The [vote library](../vote.md)'s `split` | |
| `TRANSFER_FEE`, `VOTE_FEE`, `ROOT_DECIMALS`, vote limits | `draft.fee`, `net.token.decimals`, `net.rules.vote` | |
| `snapshotAt` | The latest block's time | |

## Wiring steps

### 1. Configure the Tauri app

1. Install the SDK tarball ([Installation](../installation.md)). The Tauri entry loads no WebAssembly: no `optimizeDeps` setting and no CSP change.
2. Add `tauri-plugin-iceroot` to `src-tauri/Cargo.toml` and register `tauri_plugin_iceroot::init()` in the builder of `src-tauri/src/lib.rs` ([Tauri quickstart, step 1](../quickstart/tauri.md#1-add-the-plugin)). To use the WebAssembly entry instead, as the desktop wallet does until it registers the plugin, add `'wasm-unsafe-eval'` to `script-src` of `csp` and `devCsp`, and register `tauri_plugin_http::init()` ([The WebAssembly path](../quickstart/tauri.md#the-webassembly-path)).
3. Create `src-tauri/capabilities/main.json` granting `iceroot:default` and allowing the hosted devnet relay in the `allow` scope of `iceroot:allow-net-connect`, and list it in `app.security.capabilities`, which is empty today ([Tauri quickstart, step 2](../quickstart/tauri.md#2-grant-the-plugin-and-the-relays)). On the WebAssembly entry the capability grants `http:default` for the endpoint only.
4. Connect to the hosted HTTPS devnet endpoint (see [Devnet](../devnet.md#the-hosted-devnet-endpoint)). The plugin's requests leave from Rust, so the platforms' cleartext rules do not apply to them, but a remote devnet is reached over HTTPS. On Android the plugin checks the endpoint's certificate against the Mozilla root certificates built into it, not the device's store, so the endpoint needs a certificate from a public authority. Those roots are fixed when the app is built (the `webpki-root-certs` version in `src-tauri/Cargo.lock`; run `cargo update -p webpki-root-certs` before each release), and no certificate revocation is checked ([Tauri quickstart, TLS on Android](../quickstart/tauri.md#7-mobile)). Keep the endpoint's token out of the repository: the holder enters it in the app's settings, and the app stores it with its preferences. The token reaches the node as a request header, and `connect` takes headers in its `headers` option on both entries: the plugin sends them from Rust, and on the WebAssembly entry they go through the transport. `connect` refuses a header that HTTP does not allow with `InvalidArgument`, naming the header and never showing its value. A name must be an HTTP token, and a value must be visible ASCII, spaces and tabs, so a token pasted with a line break or a look-alike character fails there. Trim it and check it before it is saved (`tokenHeaders` below). No entry follows a redirect, so the token goes to the listed relay only.
5. Android builds need the Android NDK for the plugin's C code (libsecp256k1, and aws-lc through the HTTP client's TLS); `tauri android build` finds it through `NDK_HOME`. iOS builds need a Mac with Xcode.

### 2. The domain layer on the SDK

Keep the domain layer's role (validated data for the UI, exact amounts), and back it with the SDK:

<!-- sample: verified 0.1.0 -->
```ts
// src/domain/network.ts
import { init, connect, profiles, Address, balanceOf, type Network } from "@iceroot-network/sdk/tauri";

export type Endpoint = { relay: string; token?: string; nethash?: string };

/** The headers for the endpoint's token, or none. The token is visible ASCII without spaces. */
export function tokenHeaders(token: string | undefined): Record<string, string> | undefined {
  const text = token?.trim();
  if (!text) return undefined;
  if (!/^[\x21-\x7e]+$/.test(text)) throw new Error("The access token has characters that are not allowed. Paste it again.");
  return { authorization: `Bearer ${text}` };
}

export async function openNetwork(endpoint: Endpoint): Promise<Network> {
  await init();
  return connect(profiles.devnet({ relays: [endpoint.relay], nethash: endpoint.nethash }), {
    headers: tokenHeaders(endpoint.token),
  });
}

export async function loadWallet(net: Network, addressText: string) {
  const address = (await Address.parse(addressText, net)).toString();
  const [info, activity] = await Promise.all([
    net.accounts.get(address),
    net.history.forAccount(address, { page: 1, limit: 25 }),
  ]);
  return {
    address,
    balance: balanceOf(info),
    votes: info.vote,
    isValidator: info.validatorName !== undefined,
    activity: activity.items,
  };
}

export const loadValidators = (net: Network) => net.validators.list();
```

On the WebAssembly entry with the HTTP plugin, pass the plugin's `fetch` as `transport` only inside Tauri, and never `globalThis.fetch`: the SDK calls the transport as a method of its own client, so a browser's built-in `fetch` throws `Illegal invocation` ([Concepts](../concepts.md#networks-profiles-and-connect), [Tauri quickstart](../quickstart/tauri.md#the-webassembly-path)). The plugin entry takes no transport.

Text that comes from the chain is not safe to show as it is. A memo or a validator name can hold control characters or bidirectional formatting that reorders what the holder reads. Show it through a function like the desktop wallet's `safeText` in `src/walletData.ts`, which writes those characters as `\uXXXX`. The lines of `draft.summary` are escaped by the SDK already.

### 3. Quotes without keys

The send and vote flows show a quote before anything is signed. The draft is the quote: it gives the exact fee and the summary. A draft needs no key. Build it from the sender's public key, which works for every account, or from its address, which works once the account has sent a transaction (the node then knows the public key). For a new account an address fails with `InvalidArgument`, so the wallet keeps the public key with the address when it creates or imports the wallet (`account.publicKey`), and builds from that.

<!-- sample: verified 0.1.0 -->
```ts
// src/domain/quotes.ts
import { Address, Amount, type Account, type Network, type VoteEntry } from "@iceroot-network/sdk/tauri";

/** Who a draft is from: an open account, or a public key or an address as text. Prefer the text. */
export type Sender = Account | string;

/**
 * The sender to build with for a saved wallet, with no key: its public key when the wallet kept
 * one, else its address. The kept public key must give the kept address.
 */
export async function senderOf(net: Network, wallet: { address: string; publicKey?: string }): Promise<string> {
  if (wallet.publicKey === undefined) return wallet.address;
  if ((await Address.fromPublicKey(wallet.publicKey, net)).toString() !== wallet.address) {
    throw new Error("This wallet's public key does not match its address. Remove the wallet and add it again.");
  }
  return wallet.publicKey;
}

export async function quoteTransfer(net: Network, from: Sender, to: string, amount: string, memo: string) {
  const draft = await net.build.transfer({
    from,
    to: [{ address: await Address.parse(to.trim(), net), amount: await Amount.parse(amount.trim(), net.token.decimals) }],
    memo: memo.trim(),
  });
  return { draft, fee: draft.fee, summary: draft.summary };
}

export async function quoteVote(net: Network, from: Sender, entries: VoteEntry[]) {
  const draft = await net.build.vote({ from, entries });   // entries: [] withdraws
  return { draft, fee: draft.fee, summary: draft.summary };
}
```

- A watch-only wallet has an address and no public key. Its quote works once the account has sent a transaction. For a new account the builder refuses with `InvalidArgument`: say that the account has not sent a transaction yet, so no quote is possible until it has, or until the wallet is imported with its recovery phrase.
- The review screen shows `draft.summary.lines`, `draft.fee` and `draft.summary.total`. Nothing is signed yet, and no key is open.
- `net.build.*` reads the sender's nonce and the fee floor from the node and checks the draft against every rule of the next block. `senderOf` and the prepare functions in the desktop wallet's `src/session.ts` are the same code with `Sender` and one function per operation.

### 4. Receive and watch-only wallets

The receive page shows the wallet's address (`account.address` when the keys are open, or the saved address, or a watch-only wallet's parsed address) and its QR code. Remove the example address. A watch-only wallet is an address checked with `Address.check` and kept in the preferences, and it can show balances, activity and quotes, but its confirm button stays unavailable.

### 5. Keys: create, import, unlock and sign

The phrase is shown once for the holder to write down, encrypted into a keystore with the mobile preset, and kept only as that keystore. Afterwards the plugin opens the account straight from the keystore: the phrase never enters the page again. The key is opened after the review, for the signing only.

<!-- sample: verified 0.1.0 -->
```ts
// src/domain/keys.ts
import { Mnemonic, type Account, type Draft, type Network } from "@iceroot-network/sdk/tauri";
import { armor, encrypt, WrongPasswordOrCorrupt } from "@iceroot-network/sdk/tauri/keystore";

/** Create: a new 24-word phrase, generated in Rust, to show once. */
export const newPhrase = (): Promise<string> => Mnemonic.generate();

/** Create and import: the keystore text to keep in the platform's secure storage. */
export async function keep(phrase: string, password: Uint8Array): Promise<string> {
  const check = await Mnemonic.check(phrase);
  if (!check.ok) throw new Error(check.reason === "too-short" ? "Use your 18, 21 or 24 word recovery phrase." : "This recovery phrase is not valid.");
  return armor(await encrypt(phrase.trim(), password, "mobile"));   // the password bytes are wiped
}

/**
 * Unlock: the account, derived in the plugin, or null for a wrong password. `address` is the one
 * the holder saw and saved. A wrong index, another wallet's keystore or a changed scheme each give
 * a valid key of an address the holder never saw, so a key of another address is released and
 * refused.
 */
export async function unlock(net: Network, keystore: string, password: Uint8Array, address: string): Promise<Account | null> {
  let account: Account;
  try {
    account = await net.keys.fromKeystore(keystore, password, { account: 0, index: 0 });
  } catch (error) {
    if (error instanceof WrongPasswordOrCorrupt) return null;
    throw error;
  }
  if (account.address !== address) {
    await account.release();
    throw new Error("This keystore belongs to another wallet.");
  }
  return account;
}

/** Sign what the review showed, and release the key at once. */
export async function signReviewed(draft: Draft, account: Account) {
  try {
    return await draft.sign(account);
  } finally {
    await account.release();
  }
}
```

Then submit what was signed:

<!-- sample: verified 0.1.0 -->
```ts
// src/domain/submit.ts
import type { Network, SignedTransaction } from "@iceroot-network/sdk/tauri";

export async function submit(net: Network, signed: SignedTransaction) {
  const result = await net.submit(signed);
  if (result.status !== "accepted") return { state: "failed" as const, reason: result.reason, nodeCode: result.nodeCode };
  const status = await net.transactions.wait(signed.id, { until: "confirmed" });
  return { state: status.state === "confirmed" ? ("confirmed" as const) : ("pending" as const), id: signed.id };
}
```

- Keep the keystore text in the platform's secure storage (Android Keystore-backed storage, the iOS Keychain), never in `localStorage`. The password is never stored.
- Read passwords into a `Uint8Array` where the input allows it; the SDK overwrites it with zeros. A string typed into a field cannot be wiped.
- Compare the derived address with the saved one every time the wallet is reopened, as `unlock` does. The desktop wallet's `openWallet` in `src/keys.ts` requires the address for the same reason.
- The plugin wipes every key the page opened when the page reloads. Release the key after each signing, and when the app goes to the background or locks.
- Add the create and import controls with the architecture document's review of this boundary.
- A vote for a validator the node has not seen running is refused with `ERR_OFFLINE` (`result.nodeCode`). On a new devnet that is every validator until its node has been seen producing during the first round ([Devnet](../devnet.md#a-new-devnet-and-its-first-round)). Show the refusal's message and offer a retry later, and do not treat it as a bug of the wallet.
- The vote library's `VoteSnapshot.fromNode` makes one request per validator that has produced a block, and the node allows about 100 requests per minute per client, so on a devnet the read can take a minute or more. Read it once per visit of the vote page, show progress, and do not read it again on each render ([Vote](../vote.md)).

## Rules that apply to the mobile wallet

- No key material in the webview, `localStorage` or any file: keys live in the plugin, phrases only as keystores in the platform's secure storage ([rule 12](../rules.md), and the app's own architecture).
- Fees, decimals and vote limits come from the network ([rule 1](../rules.md)); amounts are `bigint` ([rule 2](../rules.md)).
- Addresses are checked against the network ([rule 4](../rules.md)).
- "Confirmed", never "final", on today's devnet ([rule 5](../rules.md)).
- Node failures show an error and a retry; the sample never stands in for them ([rule 13](../rules.md)).
- The review screen shows the draft that is signed, and the key is opened only after the review ([rule 15](../rules.md)).
- The saved address is checked against the derived one whenever a wallet is reopened ([rule 17](../rules.md)).
- Text from the chain (memos, names) is shown without control or bidirectional characters ([rule 16](../rules.md)).

## Tests to add

- Unit tests of the domain layer with the SDK module replaced by a stub (the plugin makes the requests, so a stub transport does not reach it), fed with the recorded devnet answers of sdk-rust's node API client fixtures.
- A test that the send and vote flows show `draft.fee`, and that a watch-only wallet cannot submit.
- A test that a quote is built from the saved public key or address with no key open, and that a key of another address is refused on unlock.
- A test that a token with a line break is refused before it is saved, and that `connect` receives the trimmed token.
- Android emulator and iOS simulator runs against the hosted endpoint: create a wallet, see it funded, send a transfer, lock and unlock with the password.
