# Devnet

Apps are wired against a development network (devnet). There is no public testnet or mainnet yet, and the SDK has no profile for either until their geneses are fixed. The first public testnet opens once finality is live.

## What today's devnet is

Today's devnet runs the reference implementation with IceRoot's economics. It uses the reference implementation's transaction formats and REST API (the Solar-compatible formats, stage `"s1"` in the SDK). Facts an app sees through the SDK:

| Fact | Value today | Read it from |
|---|---|---|
| Addresses | Base58Check, network byte 90, 34 characters starting with `d` | `Address.parse` |
| Token | ROOT, 8 decimals (1 ROOT = `100000000n` base units), the only asset; its symbol is `dRT` | `net.token` |
| Validators | 53 seats, 8-second blocks | `net.economics` |
| Votes | 1 to 53 entries, whole basis points summing to 10,000, no per-validator cap, at most 1,024 bytes; an empty vote withdraws | `net.rules.vote` |
| Fees | Size-based; about 0.01 ROOT for a one-recipient transfer; validator registration adds a 75 ROOT surcharge | `draft.fee` |
| Finality | None | `net.capabilities.has("finality")` |
| Message signatures | BIP340 over SHA-256, network `heartwood-devnet-v90` | `net.messages.sign` |

The values in the middle column are for orientation only. Apps read them from the SDK, because they change: the devnet moves to post-quantum formats at a milestone height, and the IceRoot networks have their own values (18 decimals, votes of 20 to 53 entries at 500 basis points at most, a 250 ROOT registration surcharge).

## Profile

<!-- sample: verified 0.1.0 -->
```ts
import { connect, profiles } from "@iceroot-network/sdk";

const net = await connect(profiles.devnet({
  relays: [process.env.ICEROOT_RELAY ?? "http://127.0.0.1:6003/api"],
  nethash: loadPinnedNethash(),   // undefined on first contact
}));
savePinnedNethash(net.chain.nethash);   // the same value as net.profile.chain.nethash, always set once connected
```

- The relay URL is the node's API origin plus the base path `/api`. The port depends on how the devnet was started; `6003` is used throughout these pages.
- A devnet is pinned on first contact. When a devnet is reset it gets a new identity, and `connect` throws `NetworkMismatch`. Tell the holder the network changed, and pin again only with their consent (in development, clear the stored value).

Check that a node answers before debugging the app:

<!-- sample: plain -->
```sh
curl -fsS http://127.0.0.1:6003/api/node/configuration/crypto | head -c 300; echo
curl -fsS http://127.0.0.1:6003/api/blockchain
```

## A local devnet

A local devnet runs on the machine that starts it and is the default for development and tests. Start one with the devnet tooling of your environment, with its REST API enabled, and wait until it has produced a few blocks. A one-command recipe that starts a local devnet with funded test accounts is planned for this repository.

- **Funded accounts.** A new devnet has a few genesis accounts holding the supply, and its generated wallet file lists their passphrases. These are legacy passphrase keys: import one with `net.keys.fromLegacyPassphrase(passphrase)` and fund new accounts from it. Never use a devnet passphrase for anything of value; anyone who knows the devnet's seed can derive it.
- **Keep chains short.** Stop a test devnet after a few rounds (a round is 53 blocks, about 7 minutes). Long chains make tests slow and gain nothing.
- **Rate limit.** The API allows about 100 requests per minute per client address. A local devnet shares that budget between the app, the tests and any scripts on the same machine. `connect` keeps each network to that budget by default; pass `rateLimit` when a node allows more.

## A new devnet and its first round

- **No vote is accepted at first.** A node refuses a vote that names a validator whose node it has not seen running (node code `ERR_OFFLINE`, [Vote selection](vote.md)). On a new devnet that is every validator until its node has been seen producing during the first round, which is 53 blocks, about 7 minutes. `net.validators.list()` shows such a validator without a `version`, and the vote library's snapshot leaves it out. An app that must vote early, such as a test, waits until as many active validators have a `version` as the vote will name, and stops waiting after a bounded number of blocks, for example twice the seats. A wallet shows the node's message when a vote is refused and offers a retry later. It never treats the refusal as a fault of the wallet.
- **The vote snapshot is slow.** `VoteSnapshot.fromNode` reads one request for each validator that has forged, on top of the list and the registrations, and the node allows about 100 requests per minute per client address. With the other reads of a screen in the same minute the SDK waits for budget, so the read can take a minute or more. Read it once per visit of the vote page, show that the read is going on, and reuse it for the redraws of a selection. `fromNode(net, { firstForged: false, registrations: false })` reads the list alone when the modes that need the rest are not offered.
- **A reset is a new chain.** A devnet that was reset gets a new identity, and `connect` throws `NetworkMismatch` for the pinned one ([Profile](#profile)).

## The hosted devnet endpoint

Integrators who cannot run a local devnet, and phones, use a hosted devnet endpoint over HTTPS. Android and iOS refuse plain HTTP to a remote host from their own HTTP stacks, so a phone or emulator on the WebAssembly entry needs this endpoint; the Tauri plugin's requests leave from Rust and are not subject to that rule, but a remote devnet is still reached over HTTPS. It needs an access token, sent as a request header; the URL, the header name and the token are handed out with access to the endpoint.

<!-- sample: verified 0.1.0 -->
```ts
import { connect, profiles } from "@iceroot-network/sdk";

const net = await connect(
  profiles.devnet({ relays: ["https://<devnet host>/api"] }),
  { headers: { authorization: `Bearer ${token}` } },
);
```

- A Rust backend passes the header in `HttpOptions::headers` and builds its client with `HttpClient::with_options` (see the documentation of `iceroot_sdk::api::HttpOptions`).
- Never commit the token. Read it from the environment in scripts, and from the app's settings in apps.
- The endpoint answers CORS preflight requests without the token, so browser pages and webviews can call it directly when their CSP allows the origin.
- `connect` checks the headers before it sends anything. A name must be an HTTP token, and a value must be visible ASCII, spaces and tabs. Anything else, such as a token pasted with a line break, throws `InvalidArgument` that names the header and never shows the value. Trim the token when the holder enters it.
- Both entries send the headers: the WebAssembly entry through its transport, and the Tauri plugin's entry from Rust (its `connect` takes the same `headers`).
- The token goes to the relays only: neither entry follows a redirect, and a relay that answers with one is skipped. A custom transport must honour `redirect: "manual"` for that to hold.
- A custom transport is a function with the signature of `fetch`. Do not pass the built-in `fetch` itself: the SDK calls the transport as a method, so a browser throws `Illegal invocation`. Pass `(input, init) => fetch(input, init)`, or nothing ([Concepts](concepts.md#networks-profiles-and-connect)).

## Emulators and simulators

- **Android emulator.** The host machine is `10.0.2.2` from inside the emulator. A page's own requests to it over plain HTTP are refused unless the app allows cleartext for that host; the Tauri plugin's requests leave from Rust and are not subject to that rule, but its capability must allow the relay. Prefer the hosted HTTPS endpoint; the plugin checks its certificate against the Mozilla root certificates built into it (fixed when the app is built, with no revocation check; see the [Tauri quickstart](quickstart/tauri.md#7-mobile)).
- **iOS simulator.** The simulator shares the host's network, so `127.0.0.1` reaches a local devnet, and App Transport Security allows plain HTTP to localhost only. A physical iPhone needs the HTTPS endpoint.
