# Devnet

Apps are wired against a development network (devnet). There is no public testnet or mainnet yet, and the SDK has no profile for either until their geneses are fixed.

## What today's devnet is

Today's devnet runs the reference implementation with IceRoot's economics. It uses the reference implementation's transaction formats and REST API (the Solar-compatible formats, stage `"s1"` in the SDK). Facts an app sees through the SDK:

| Fact | Value today | Read it from |
|---|---|---|
| Addresses | Base58Check, network byte 90, 34 characters starting with `d` | `Address.parse` |
| Token | ROOT, 8 decimals (1 ROOT = `100000000n` base units), the only asset | `net.token` |
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

## The hosted devnet endpoint

Integrators who cannot run a local devnet, and phones, use a hosted devnet endpoint over HTTPS. Android and iOS refuse plain HTTP to a remote host, so a phone or emulator always needs this endpoint. It needs an access token, sent as a request header; the URL, the header name and the token are handed out with access to the endpoint.

<!-- sample: verified 0.1.0 -->
```ts
import { connect, profiles } from "@iceroot-network/sdk";

const net = await connect(
  profiles.devnet({ relays: ["https://<devnet host>/api"] }),
  { headers: { authorization: `Bearer ${token}` } },
);
```

- Never commit the token. Read it from the environment in scripts, and from the app's settings in apps.
- The endpoint answers CORS preflight requests without the token, so browser pages and webviews can call it directly when their CSP allows the origin.

## Emulators and simulators

- **Android emulator.** The host machine is `10.0.2.2` from inside the emulator, and plain HTTP to it is refused unless the app allows cleartext for that host. Prefer the hosted HTTPS endpoint.
- **iOS simulator.** The simulator shares the host's network, so `127.0.0.1` reaches a local devnet, and App Transport Security allows plain HTTP to localhost only. A physical iPhone needs the HTTPS endpoint.
