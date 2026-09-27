# Integration guide: mobile wallet

The mobile wallet (`iceroot-network/mobile-wallet`) is one Vite, React 19 and Tauri 2 app for Android (minimum SDK 24) and iOS 15. Today its domain layer, `src/domain/wallet.ts`, reads `public/mock-test-api.json` and applies transfers and votes to that sample in memory.

The app's architecture document requires a reviewed native key vault before any create or import control exists. That decides the order of wiring:

- **With release 0.1.0:** the read side (balances, history, validators, receive addresses of watch-only wallets) and real fee quotes from drafts, over HTTPS with requests made from Rust.
- **With the native plugin and keystore release:** create, import, signing, transfers and votes. The plugin implements the same interface, so the code written for 0.1.0 stays.

Read first: [Concepts](../concepts.md), [Rules](../rules.md), [Tauri quickstart](../quickstart/tauri.md), [Devnet](../devnet.md).

## What to wire now and what waits

| Part | Release 0.1.0 | Waits for |
|---|---|---|
| HTTPS connection to the hosted devnet endpoint, requests from Rust | Wire now | |
| Watch-only wallets: balances, activity, receive address with QR code | Wire now | |
| Validator directory | Wire now | |
| Transfer and vote quotes (fee, total) from drafts | Wire now | |
| Create and import, keys, signing, submitting transfers and votes | No create or import controls | The native plugin and keystore release |
| Vote modes | Keep the even split | The vote library release |
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
| `Wallet.address` | `net.keys.watch(Address.parse(text, net))` now; `account.address` from the keystore later | |
| `Wallet.balance`, `assets[]` holdings | `net.accounts.get(address).balances` | `bigint`; format with `Amount.format` |
| `Wallet.votes` (`validatorId`) | `net.accounts.get(address).vote` (`validator`) | `validator` is the validator's name |
| `Asset` with `id: "root"`, 18 decimals | `net.token` | 8 decimals on today's devnet |
| `Transaction` list | `net.history.forAccount(address, { page, limit })` | Status `pending` or `confirmed`; `simulated` goes away |
| `Validator`: `name`, `rank`, `status`, `votingBalance`, `validatedBlocks` | `net.validators.list()`: `name`, `rank`, `status`, `voteWeight`, `production.forged` | `uptime` from `production` (lifetime counters today); `tagline` is not chain data |
| `formatAmount(decimalString)` | `Amount.format(units, decimals, { maxFraction, grouping: true })` | |
| `prepareTransfer` returning `TransferQuote` | `net.build.transfer(...)` returning a draft: `draft.fee`, `draft.summary` | Works without a key: a draft needs only the sender's address |
| `submitTransfer` | `draft.sign(account)`, `net.submit`, `net.transactions.wait` | After the native plugin |
| `prepareVote`, `submitVote` | `net.build.vote`, then sign and submit | Signing after the native plugin |
| `splitVote` | Keep (with `validator` names and `net.rules.vote.totalBasisPoints`) | Replaced by the vote library's `split` later |
| `TRANSFER_FEE`, `VOTE_FEE`, `ROOT_DECIMALS`, vote limits | `draft.fee`, `net.token.decimals`, `net.rules.vote` | |
| `snapshotAt` | The latest block's time | |

## Wiring steps

### 1. Configure the Tauri app

1. Install the SDK tarball and exclude it from Vite's `optimizeDeps` ([Vite quickstart](../quickstart/vite-react.md#2-configure-vite)).
2. Add `'wasm-unsafe-eval'` to `script-src` in `csp` and `devCsp` ([Tauri quickstart](../quickstart/tauri.md#2-allow-webassembly-in-the-webviews-csp)), and check WebAssembly loads on the iOS 15 floor (the WebKit note there).
3. Add the HTTP plugin, register it, and create `src-tauri/capabilities/main.json` with `http:default` allowing the hosted devnet URL; list the capability in `app.security.capabilities` ([Tauri quickstart, step 3](../quickstart/tauri.md#3-send-node-requests-through-rust)).
4. Connect to the hosted HTTPS devnet endpoint (see [Devnet](../devnet.md#the-hosted-devnet-endpoint)). Phones and emulators refuse plain HTTP to a remote host. Keep the endpoint's token out of the repository: the holder enters it in the app's settings, and the app stores it with its preferences.

### 2. The domain layer on the SDK

Keep the domain layer's role (validated data for the UI, exact amounts), and back it with the SDK:

<!-- sample: pending; needs: init, connect, profiles.devnet, connect-headers, transport-option, tauri-http-transport, net.accounts.get, net.history.forAccount, net.validators.list, Address.parse, Network -->
```ts
// src/domain/network.ts
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "@tauri-apps/api/core";
import { init, connect, profiles, Address, type Network } from "@iceroot-network/sdk";

export type Endpoint = { relay: string; token?: string; nethash?: string };

export async function openNetwork(endpoint: Endpoint): Promise<Network> {
  await init();
  return connect(profiles.devnet({ relays: [endpoint.relay], nethash: endpoint.nethash }), {
    transport: isTauri() ? tauriFetch : globalThis.fetch,
    headers: endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : undefined,
  });
}

export async function loadWallet(net: Network, addressText: string) {
  const address = Address.parse(addressText, net).toString();
  const [info, activity] = await Promise.all([
    net.accounts.get(address),
    net.history.forAccount(address, { page: 1, limit: 25 }),
  ]);
  return {
    address,
    balance: info.balances.get(net.token.assetId) ?? 0n,
    votes: info.vote,
    isValidator: info.validator !== null,
    activity: activity.items,
  };
}

export const loadValidators = (net: Network) => net.validators.list();
```

### 3. Quotes without keys

The send and vote flows show a quote before submission. Build the draft for the quote now; it gives the exact fee and the summary, and needs only the sender's address:

<!-- sample: pending; needs: net.build.transfer, net.build.vote, draft.fee, draft.summary, Address.parse, Amount.parse, VoteEntry -->
```ts
// src/domain/quotes.ts
import { Address, Amount, type Network, type VoteEntry } from "@iceroot-network/sdk";

export async function quoteTransfer(net: Network, from: string, to: string, amount: string, memo: string) {
  const draft = await net.build.transfer({
    from,
    to: [{ address: Address.parse(to.trim(), net), amount: Amount.parse(amount.trim(), net.token.decimals) }],
    memo: memo.trim(),
  });
  return { draft, fee: draft.fee, summary: draft.summary };
}

export async function quoteVote(net: Network, from: string, entries: VoteEntry[]) {
  const draft = await net.build.vote({ from, entries });   // entries: [] withdraws
  return { draft, fee: draft.fee, summary: draft.summary };
}
```

Until the native plugin is released, the confirm button of these flows stays unavailable for real wallets, with a short note that signing arrives with the secure key store. Do not add a temporary signer in the webview.

### 4. Receive

The receive page shows a watch-only wallet's parsed address (`Address.parse(...).toString()`) and its QR code. Remove the example address.

### 5. Later: keys and signing

When the native plugin and keystore are released:

<!-- sample: later; needs: sdk/tauri, tauri-plugin-iceroot, keystore -->
```ts
import { connect, profiles, Keystore, Mnemonic } from "@iceroot-network/sdk/tauri";

const phrase = Mnemonic.generate();                                  // generated in Rust
const stored = await Keystore.create(phrase, password);             // encrypted in Rust; the app keeps the bytes in native storage
const account = await net.keys.fromKeystore(stored, password, { account: 0, index: 0 });
const signed = draft.sign(account);                                  // signed in Rust
```

- Register `tauri_plugin_iceroot::init()` in `src-tauri/src/lib.rs`, switch the import to `@iceroot-network/sdk/tauri`, and remove `'wasm-unsafe-eval'` and the HTTP plugin if nothing else uses them.
- Add the create and import controls then, with the architecture document's review of the vault.

## Rules that apply to the mobile wallet

- No key material in the webview, `localStorage` or any file until the native vault exists ([rule 12](../rules.md), and the app's own architecture).
- Fees, decimals and vote limits come from the network ([rule 1](../rules.md)); amounts are `bigint` ([rule 2](../rules.md)).
- Addresses are checked against the network ([rule 4](../rules.md)).
- "Confirmed", never "final", on today's devnet ([rule 5](../rules.md)).
- Node failures show an error and a retry; the sample never stands in for them ([rule 13](../rules.md)).

## Tests to add

- The existing unit tests move from the fixture to a stub transport with recorded devnet responses.
- A test that the send and vote flows show `draft.fee` and cannot submit without a key.
- Android emulator and iOS simulator runs against the hosted endpoint: a watch-only wallet shows its balance and activity.
