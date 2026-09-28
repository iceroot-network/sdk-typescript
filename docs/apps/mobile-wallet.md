# Integration guide: mobile wallet

The mobile wallet (`iceroot-network/mobile-wallet`) is one Vite, React 19 and Tauri 2 app for Android (minimum SDK 24) and iOS 15. Today its domain layer, `src/domain/wallet.ts`, reads `public/mock-test-api.json` and applies transfers and votes to that sample in memory.

The app's architecture document requires a reviewed native key vault before any create or import control exists. The SDK's native Tauri plugin, `tauri-plugin-iceroot`, is that boundary: keys are derived, held and used in Rust, the page holds opaque handles, recovery phrases are kept only as [keystores](../keystore.md) encrypted natively with the mobile preset, and every request to the node leaves from Rust. The wallet registers the plugin and imports `@iceroot-network/sdk/tauri`.

Read first: [Concepts](../concepts.md), [Rules](../rules.md), [Tauri quickstart](../quickstart/tauri.md), [Devnet](../devnet.md). The [Tauri example](../../examples/tauri-plugin/README.md) is a working plugin app.

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
| `prepareTransfer` returning `TransferQuote` | `net.build.transfer(...)` returning a draft: `draft.fee`, `draft.summary` | Works without a key: a draft needs the sender's address once the account has sent a transaction, and its public key before that |
| `submitTransfer` | `draft.sign(account)` (in the plugin), `net.submit`, `net.transactions.wait` | |
| `prepareVote`, `submitVote` | `net.build.vote`, then sign and submit | |
| `splitVote` | The [vote library](../vote.md)'s `split` | |
| `TRANSFER_FEE`, `VOTE_FEE`, `ROOT_DECIMALS`, vote limits | `draft.fee`, `net.token.decimals`, `net.rules.vote` | |
| `snapshotAt` | The latest block's time | |

## Wiring steps

### 1. Configure the Tauri app

1. Install the SDK tarball ([Installation](../installation.md)). The Tauri entry loads no WebAssembly: no `optimizeDeps` setting and no CSP change.
2. Add `tauri-plugin-iceroot` to `src-tauri/Cargo.toml` and register `tauri_plugin_iceroot::init()` in the builder of `src-tauri/src/lib.rs` ([Tauri quickstart, step 1](../quickstart/tauri.md#1-add-the-plugin)).
3. Create `src-tauri/capabilities/main.json` granting `iceroot:default` and allowing the hosted devnet relay in the `allow` scope of `iceroot:allow-net-connect`, and list it in `app.security.capabilities`, which is empty today ([Tauri quickstart, step 2](../quickstart/tauri.md#2-grant-the-plugin-and-the-relays)).
4. Connect to the hosted HTTPS devnet endpoint (see [Devnet](../devnet.md#the-hosted-devnet-endpoint)). The plugin's requests leave from Rust, so the platforms' cleartext rules do not apply to them, but a remote devnet is reached over HTTPS. On Android the plugin checks the endpoint's certificate against the Mozilla root certificates built into it, not the device's store, so the endpoint needs a certificate from a public authority. Those roots are fixed when the app is built (the `webpki-root-certs` version in `src-tauri/Cargo.lock`; run `cargo update -p webpki-root-certs` before each release), and no certificate revocation is checked ([Tauri quickstart, TLS on Android](../quickstart/tauri.md#7-mobile)). Keep the endpoint's token out of the repository: the holder enters it in the app's settings, and the app stores it with its preferences.
5. Android builds need the Android NDK for the plugin's C code (libsecp256k1, and aws-lc through the HTTP client's TLS); `tauri android build` finds it through `NDK_HOME`. iOS builds need a Mac with Xcode.

### 2. The domain layer on the SDK

Keep the domain layer's role (validated data for the UI, exact amounts), and back it with the SDK:

<!-- sample: verified 0.1.0 -->
```ts
// src/domain/network.ts
import { init, connect, profiles, Address, balanceOf, type Network } from "@iceroot-network/sdk/tauri";

export type Endpoint = { relay: string; token?: string; nethash?: string };

export async function openNetwork(endpoint: Endpoint): Promise<Network> {
  await init();
  return connect(profiles.devnet({ relays: [endpoint.relay], nethash: endpoint.nethash }), {
    headers: endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : undefined,
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

### 3. Keys: create, import, unlock

The phrase is shown once for the holder to write down, encrypted into a keystore with the mobile preset, and kept only as that keystore. Afterwards the plugin opens the account straight from the keystore: the phrase never enters the page again.

<!-- sample: verified 0.1.0 -->
```ts
// src/domain/keys.ts
import { Mnemonic, type Account, type Network } from "@iceroot-network/sdk/tauri";
import { armor, encrypt, WrongPasswordOrCorrupt } from "@iceroot-network/sdk/tauri/keystore";

/** Create: a new 24-word phrase, generated in Rust, to show once. */
export const newPhrase = (): Promise<string> => Mnemonic.generate();

/** Create and import: the keystore text to keep in the platform's secure storage. */
export async function keep(phrase: string, password: Uint8Array): Promise<string> {
  const check = await Mnemonic.check(phrase);
  if (!check.ok) throw new Error(check.reason === "too-short" ? "Use your 18, 21 or 24 word recovery phrase." : "This recovery phrase is not valid.");
  return armor(await encrypt(phrase.trim(), password, "mobile"));   // the password bytes are wiped
}

/** Unlock: the account, derived in the plugin; null for a wrong password. */
export async function unlock(net: Network, keystore: string, password: Uint8Array): Promise<Account | null> {
  try {
    return await net.keys.fromKeystore(keystore, password, { account: 0, index: 0 });
  } catch (error) {
    if (error instanceof WrongPasswordOrCorrupt) return null;
    throw error;
  }
}
```

- Keep the keystore text in the platform's secure storage (Android Keystore-backed storage, the iOS Keychain), never in `localStorage`. The password is never stored.
- Read passwords into a `Uint8Array` where the input allows it; the SDK overwrites it with zeros. A string typed into a field cannot be wiped.
- `account.release()` when the app goes to the background or locks. The plugin also wipes every key the page opened when the page reloads.
- Add the create and import controls with the architecture document's review of this boundary.

### 4. Quotes, signing and submitting

The send and vote flows show a quote before submission. The draft is the quote: it gives the exact fee and the summary. Then the plugin signs what the review showed:

<!-- sample: verified 0.1.0 -->
```ts
// src/domain/quotes.ts
import { Address, Amount, type Account, type Draft, type Network, type VoteEntry } from "@iceroot-network/sdk/tauri";

export async function quoteTransfer(net: Network, from: Account, to: string, amount: string, memo: string) {
  const draft = await net.build.transfer({
    from,
    to: [{ address: await Address.parse(to.trim(), net), amount: await Amount.parse(amount.trim(), net.token.decimals) }],
    memo: memo.trim(),
  });
  return { draft, fee: draft.fee, summary: draft.summary };
}

export async function quoteVote(net: Network, from: Account, entries: VoteEntry[]) {
  const draft = await net.build.vote({ from, entries });   // entries: [] withdraws
  return { draft, fee: draft.fee, summary: draft.summary };
}

export async function submit(net: Network, draft: Draft, account: Account) {
  const signed = await draft.sign(account);
  const result = await net.submit(signed);
  if (result.status !== "accepted") return { state: "failed" as const, reason: result.reason };
  const status = await net.transactions.wait(signed.id, { until: "confirmed" });
  return { state: status.state === "confirmed" ? ("confirmed" as const) : ("pending" as const), id: signed.id };
}
```

A watch-only wallet has no key: its quote can be built from its address once the account has sent a transaction (the node then knows its public key), and its confirm button stays unavailable.

### 5. Receive

The receive page shows the wallet's address (`account.address`, or a watch-only wallet's parsed address) and its QR code. Remove the example address.

## Rules that apply to the mobile wallet

- No key material in the webview, `localStorage` or any file: keys live in the plugin, phrases only as keystores in the platform's secure storage ([rule 12](../rules.md), and the app's own architecture).
- Fees, decimals and vote limits come from the network ([rule 1](../rules.md)); amounts are `bigint` ([rule 2](../rules.md)).
- Addresses are checked against the network ([rule 4](../rules.md)).
- "Confirmed", never "final", on today's devnet ([rule 5](../rules.md)).
- Node failures show an error and a retry; the sample never stands in for them ([rule 13](../rules.md)).
- The review screen shows the draft that is signed ([rule 15](../rules.md)).

## Tests to add

- Unit tests of the domain layer with the SDK module replaced by a stub (the plugin makes the requests, so a stub transport does not reach it), fed with the recorded devnet answers of sdk-rust's node API client fixtures.
- A test that the send and vote flows show `draft.fee`, and that a watch-only wallet cannot submit.
- Android emulator and iOS simulator runs against the hosted endpoint: create a wallet, see it funded, send a transfer, lock and unlock with the password.
