# Integration guide: browser wallet

The browser wallet (`iceroot-network/browser-wallet`) is a static web app and a Manifest V3 extension built from the same files, plus a separate legacy signer. Today it has two modes: a demo that reads `data/mock-test-api.json`, and a devnet signing identity that signs validators-portal sign-in messages. The identity's cryptography runs in a sandbox page with a bundle of `@noble` and `@scure` libraries (`identity-crypto.js`), and the sign-in format is checked by `signing-protocol.js` in three places.

After wiring, the SDK does all of this: one implementation of keys, addresses, message signing and the sign-in check, shared with the validators portal, and a live devnet wallet whose transactions are built in the wallet page and signed in the sandbox.

Read first: [Concepts](../concepts.md), [Rules](../rules.md), [Manifest V3 quickstart](../quickstart/mv3-extension.md), [Devnet](../devnet.md).

## What to wire now and what waits

| Part | Release 0.1.0 | Waits for |
|---|---|---|
| SDK loaded in the wallet page, the sandbox page and the service worker | Wire now | |
| Sign-in check with `SignIn.parse` in the service worker and the sandbox; `signing-protocol.js` retired | Wire now | |
| Existing 12-word devnet identities, through the legacy passphrase import | Wire now | Retired with the devnet formats |
| New identities: 24 words, hardened derivation | Wire now | |
| Live devnet wallet: balances, history, validators, transfers (1 to 256 recipients, one memo), votes, signed in the sandbox | Wire now | |
| The encrypted vault | Move to the [keystore](../keystore.md) format once (web preset, in the sandbox page or the service worker); keep the current vault until that move | |
| Vote modes with reasons, and `check` of the holder's vote | Wire now with the [vote library](../vote.md) (`IceRootSdk.vote` in the classic script) | Indexer figures for Reliability, Maximum Rewards and Support Newcomers |
| Legacy signer | No change | The SDK's ownership-proof functions (a later release); switching is optional |
| Names, assets other than ROOT, finality | Hide | The capabilities of later networks |

## The current layer

| File | Role today |
|---|---|
| `wallet.js` | The wallet page. `exploreDemo` loads the fixture; `FEES = { transfer: 0.1, vote: 1 }`; `decimals = () => 18`, `toAtomic`, `fromAtomic`; `loadProducers` maps `demo.validators` to the reference API's delegate shape (`username`, `blocks.productivity`, `votesReceived.votes`); a vote basket in percentages with two decimals; `openConfirm` and a simulated execution |
| `data/mock-test-api.json` | Schema version 1: `wallets` (with `vote` as `{ name: percent }`), `assets`, `transactions`, `validators`, `contacts` |
| `sandbox.html`, `sandbox.js` | The sandboxed page: `generateMnemonic` (12 words), `heartwoodIdentity` (key = SHA-256 of the phrase), `heartwoodSignChallenge` (checks the challenge, signs BIP340 over SHA-256) |
| `identity.html`, `identity.js` | The identity page: the vault (`iceroot.browserwallet.heartwood.identity.v1`, PBKDF2-SHA256 600,000 rounds, AES-256-GCM), unlock and idle lock, the approval screens, `cryptoCall` to the sandbox |
| `signing-protocol.js` | `IceRootSigning`: `NETWORK`, `ALGORITHM`, `allowedOrigin`, `siteOrigin`, `publicAccount`, `challenge` |
| `extension/background.js` | `importScripts('signing-protocol.js')`; the website allow-list; pending requests; `siteOrigin` for the settings |
| `extension/manifest.json` | CSP `extension_pages` and `sandbox` without `'wasm-unsafe-eval'` |
| `identity-crypto.js`, `_build-identity-crypto/` | The `@noble` and `@scure` bundle and its reproducible build |
| `scripts/runtime-files.mjs`, `scripts/build.mjs` | Which files go into `dist/web` and `dist/extension` |

## Mapping

| Today | SDK |
|---|---|
| `IceRootSigning.challenge(message, expected)` | `SignIn.parse(message, profile, { origin, address, publicKey, now })`, with every expected field |
| `IceRootSigning.NETWORK`, `ALGORITHM` | `messageNetworkOf(profile)` and `messageAlgorithmOf(profile)` (`heartwood-devnet-v90` and `secp256k1-bip340-sha256` today), which every message signature also carries |
| `IceRootSigning.publicAccount(account)` | The identity's `{ publicKey, address, network, algorithm }` from the sandbox, built by the SDK |
| `IceRootSigning.allowedOrigin` | Inside `SignIn.parse` for the message's origin; the check of the requesting page stays in the wallet (`site-policy.js`) |
| `IceRootSigning.siteOrigin` | Stays in the wallet: it is the settings list's rule, not the sign-in format (`site-policy.js`) |
| `generateMnemonic` (12 words) | `Mnemonic.generate()` (24 words) |
| `heartwoodIdentity` (SHA-256 of the phrase) | `Keys.fromLegacyPassphrase(phrase, profile)` for existing identities; `Keys.fromPhrase(phrase, profile, { account, index })` for new ones |
| `heartwoodSignChallenge` | `SignIn.parse`, then `Messages.sign(account, message)` |
| Demo `walletData = { balance, nonce, votingFor, attributes }` | `net.accounts.get(address)`: `balances`, `nonce`, `vote`, `validator` |
| `FEES` | `draft.fee` |
| `decimals()`, `toAtomic`, `fromAtomic` | `net.token.decimals`, `Amount.parse`, `Amount.format` |
| `loadProducers` from `demo.validators` | `net.validators.list()`: `name`, `rank`, `status`, `production`, `voteWeight` |
| Vote basket in percentages | Entries of `{ validator, basisPoints }`; see [votes](#votes) |
| `openConfirm` and the simulated execution | A draft reviewed and signed in the sandbox, submitted and followed from the wallet page |

## Wiring steps

### 1. Ship the SDK's files

Add the SDK as a dependency and copy its classic-script build into the runtime files at build time, as in the [Manifest V3 quickstart](../quickstart/mv3-extension.md#2-copy-the-sdks-files-into-the-extension):

- `package.json`: the SDK tarball in `devDependencies` (it is copied into `dist`, not imported by a bundler).
- A copy step (for example `scripts/vendor-sdk.mjs`, run by `npm run build` and `npm run dev`) that writes `vendor/iceroot-sdk/iceroot-sdk.js`, `iceroot-sdk_bg.wasm` and `iceroot-sdk-bytes.js` from the package's `dist/iife/`, and checks them against the release's `SHA256SUMS` where it lists them.
- `scripts/runtime-files.mjs`: add `vendor` to `RUNTIME_DIRECTORIES`. The legacy signer's file list does not change.
- `.gitignore`: `vendor/`.

### 2. Content Security Policies

`'wasm-unsafe-eval'` is needed wherever the SDK runs. Every other directive stays as it is; the sandbox keeps `connect-src 'none'`.

<!-- sample: verified 0.1.0 -->
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-src 'self'",
    "sandbox": "sandbox allow-scripts; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'none'; default-src 'none'"
  }
}
```

| File | `script-src` | `connect-src` |
|---|---|---|
| `extension/manifest.json` `extension_pages` (also covers the service worker) | add `'wasm-unsafe-eval'` | unchanged |
| `extension/manifest.json` `sandbox` | add `'wasm-unsafe-eval'` | `'none'`, unchanged |
| `sandbox.html` meta | add `'wasm-unsafe-eval'` | `'none'`, unchanged |
| `index.html` meta (the wallet page) | add `'wasm-unsafe-eval'` | add the devnet origin, for example `https://<devnet host>` |
| `identity.html` meta | unchanged, if the identity page does not load the SDK (recommended below) | `'none'`, unchanged |

For the web build served over HTTPS, the same meta policies apply; the devnet origin must be HTTPS.

### 3. The service worker

`signing-protocol.js` mixes two things: the sign-in format, which moves to the SDK, and the wallet's own site rules (`allowedOrigin` for requesting pages, `siteOrigin` for the settings list), which stay in the wallet. Move the site rules to a small file, for example `site-policy.js`, loaded by the worker and by `sites.js`, and load the SDK in the worker:

<!-- sample: verified 0.1.0 -->
```js
// extension/background.js (top of the file)
importScripts("vendor/iceroot-sdk/iceroot-sdk.js", "vendor/iceroot-sdk/iceroot-sdk-bytes.js", "site-policy.js");
IceRootSdk.initSync(IceRootSdkWasmBytes);
// Never contacted: the worker uses the profile only for the devnet's address format.
const devnet = IceRootSdk.profiles.devnet({ relays: ["http://127.0.0.1:6003/api"] });

// Throws with the reason unless the message is a valid version 1 sign-in for this origin and key.
// The sandbox checks every field again, against the selected identity, before it signs.
function checkSignIn(message, origin, publicKey) {
  const address = IceRootSdk.Address.fromPublicKey(publicKey, devnet).toString();
  return IceRootSdk.SignIn.parse(message, devnet, { origin, address, publicKey, now: new Date() });
}

// Replaces IceRootSigning.publicAccount: the identity the identity page returns must be consistent.
function checkIdentity(identity) {
  const address = IceRootSdk.Address.fromPublicKey(identity.publicKey, devnet).toString();
  if (address !== identity.address) throw new Error("Invalid devnet signing identity.");
  return { publicKey: identity.publicKey, address, network: identity.network, algorithm: identity.algorithm };
}
```

| `background.js` today | After wiring |
|---|---|
| `Protocol.challenge(params.message, { origin, publicKey, network })` when a request arrives | `checkSignIn(params.message, origin, params.publicKey)`; compare `params.network` with the returned `network` |
| `Date.parse(Protocol.challenge(params.message).expiresAt)` for the request deadline | The `expiresAt` of the parsed fields |
| `Protocol.publicAccount(message.result)` for `connect` | `checkIdentity(message.result)` |
| `supplied.network !== Protocol.NETWORK`, `supplied.algorithm !== Protocol.ALGORITHM` | Compare with the parsed challenge's `network` and with the `algorithm` of the identity that `connect` shared |
| `Protocol.allowedOrigin`, `Protocol.siteOrigin` | The same functions from `site-policy.js` |

Keep the website allow-list, the pending-request store and the approval flow exactly as they are.

### 4. The sandbox

Rewrite `sandbox.js` on the SDK. It keeps its role (keys only while signing, no network, answers only its embedder) and gains the transaction operations:

<!-- sample: verified 0.1.0 -->
```js
// sandbox.js
(function () {
  "use strict";
  const Sdk = globalThis.IceRootSdk;
  Sdk.initSync(globalThis.IceRootSdkWasmBytes);

  // `args.devnet` is the wallet's stored devnet setting, { relay, nethash }; nothing here contacts the relay.
  const profileFor = (devnet) => Sdk.profiles.devnet({ relays: [devnet.relay], nethash: devnet.nethash });
  const toJson = (value) => JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)));

  // scheme "legacy-passphrase": identities created before the SDK (12 words, key = SHA-256 of the phrase).
  // scheme "bip32": new identities (24 words, hardened derivation at account and index).
  function withAccount(args, use) {
    const profile = profileFor(args.devnet);
    const account = args.scheme === "legacy-passphrase"
      ? Sdk.Keys.fromLegacyPassphrase(args.phrase, profile)
      : Sdk.Keys.fromPhrase(args.phrase, profile, { account: args.account ?? 0, index: args.index ?? 0 });
    try { return use(account, profile); } finally { account.release(); }
  }
  // The public identity a website receives from `connect`: { publicKey, address, network, algorithm }.
  const publicIdentity = (account, profile) => ({
    publicKey: account.publicKey, address: account.address,
    network: Sdk.messageNetworkOf(profile), algorithm: Sdk.messageAlgorithmOf(profile),
  });

  const ops = {
    ping: () => ({ ready: true }),
    generatePhrase: () => Sdk.Mnemonic.generate(),
    identity: (args) => withAccount(args, publicIdentity),
    // `args.expected` is { origin, address, publicKey }: the requesting origin and the selected identity.
    parseSignIn: (args) => toJson(Sdk.SignIn.parse(args.message, profileFor(args.devnet), { ...args.expected, now: new Date() })),
    signSignIn: (args) => withAccount(args, (account, profile) => {
      Sdk.SignIn.parse(args.message, profile, { origin: args.origin, address: account.address, publicKey: account.publicKey, now: new Date() });
      const signed = Sdk.Messages.sign(account, args.message);   // { publicKey, signature, network, algorithm }
      return { publicKey: signed.publicKey, signature: signed.signature, network: signed.network, algorithm: signed.algorithm };
    }),
    reviewDraft: (args) => {
      const draft = Sdk.Draft.deserialize(args.draft, profileFor(args.devnet));   // refuses another network
      return { summary: toJson(draft.summary), fee: draft.fee.toString() };
    },
    signDraft: (args) => withAccount(args, (account, profile) => {
      const draft = Sdk.Draft.deserialize(args.draft, profile);
      return { signed: draft.sign(account).serialize() };
    }),
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.__iceroot !== 1 || typeof message.id === "undefined") return;
    const reply = { __iceroot: 1, id: message.id, ok: false, result: null, error: null };
    try {
      if (!Object.hasOwn(ops, message.op)) throw new Error("unknown op: " + message.op);
      reply.result = ops[message.op](message.args || {});
      reply.ok = true;
    } catch (error) {
      reply.error = error?.message ?? String(error);
    }
    event.source.postMessage(reply, "*");
  });
})();
```

`sandbox.html` loads `vendor/iceroot-sdk/iceroot-sdk.js`, `vendor/iceroot-sdk/iceroot-sdk-bytes.js` and `sandbox.js`, and no longer `identity-crypto.js` or `signing-protocol.js`.

### 5. The identity page and the vault

- **Existing identities.** A vault saved before the SDK holds a 12-word phrase whose key is the SHA-256 of the phrase. Treat every existing vault as `scheme: "legacy-passphrase"`; the SDK's legacy import gives the same public key and address as today. Keep a word-count and word-list check on this restore path, because the legacy import itself accepts any text.
- **New identities.** Create with `generatePhrase` (24 words) and store `scheme: "bip32"` with `account: 0, index: 0`. Restore accepts 18, 21 or 24 words.
- **Vault format.** Add `scheme`, `account` and `index` to the authenticated identity metadata (the AES-GCM additional data), under a new vault key version. The same phrase gives different keys under the two schemes, so the scheme must never be guessed.
- **Approval screens.** The identity page asks the sandbox (`parseSignIn`) for the checked fields it displays, so it needs no SDK of its own and its CSP stays unchanged.
- **Devnet setting.** The identity page passes the wallet's stored devnet setting (`{ relay, nethash }`, written by the wallet page when it connects) to every sandbox operation as `devnet`.
- Keep the rest: the password rules, the idle lock, the storage event handling, the manual sign-in flow (its output JSON keeps the `publicKey`, `signature`, `network` and `algorithm` fields the portal accepts).

### 6. The live devnet wallet

The wallet page (`wallet.js`) talks to the network. Add a devnet mode next to the demo:

<!-- sample: verified 0.1.0 -->
```js
// wallet.js: devnet mode (inside the page's existing module pattern)
const Sdk = globalThis.IceRootSdk;
let net = null;

async function openDevnet(settings) {
  await Sdk.init(new URL("vendor/iceroot-sdk/iceroot-sdk_bg.wasm", location.href));
  net = await Sdk.connect(Sdk.profiles.devnet({ relays: [settings.relay], nethash: settings.nethash }), {
    headers: settings.token ? { authorization: "Bearer " + settings.token } : {},
  });
  return net.chain.nethash;   // store with the settings on first contact
}

async function loadAccount(address) {
  const [info, history, validators] = await Promise.all([
    net.accounts.get(address),
    net.history.forAccount(address, { page: 1, limit: 25 }),
    net.validators.list(),
  ]);
  const { decimals, symbol } = net.token;
  return {
    balance: Sdk.balanceOf(info),
    balanceText: Sdk.Amount.format(Sdk.balanceOf(info), decimals) + " " + symbol,
    vote: info.vote,
    history: history.items,
    validators: validators.items,
  };
}
```

- The devnet account is the identity's address; the wallet page gets it from the identity metadata, never from a key.
- `index.html`'s settings get the devnet relay, the pinned identity and, for the hosted endpoint, the token.
- The demo stays separate: its screens never read the network, and the devnet screens never read the fixture.

### 7. Transfers and votes

The wallet page builds the draft; the identity page reviews and signs it through the sandbox; the wallet page submits it:

1. `wallet.js` builds `net.build.transfer({ from, to: [...1 to 256 recipients], memo })` or `net.build.vote({ from, entries })`, and serializes it with `draft.serialize()`. `from` is the identity's public key from its metadata: the builder reads the nonce from the node. The address alone works only once the identity has sent a transaction, because the node learns the public key from it.
2. It hands the bytes to the identity page as a transaction request. In the extension this goes through the service worker's pending-request store, like website requests, but only from the extension's own wallet page: refuse a transaction request from any other sender, and never accept one from a website. In the web build the wallet page opens the identity page with the request.
3. The identity page unlocks the vault if needed, calls the sandbox's `reviewDraft`, and shows the recomputed summary and fee. On approval it calls `signDraft` with the phrase and scheme, and returns the signed bytes.
4. `wallet.js` restores them with `SignedTransaction.deserialize(bytes, net.profile)`, checks with `signed.matches(draft)` that they are the draft it sent, calls `net.submit`, and follows `net.transactions.wait(id, { until: "confirmed" })`.

<!-- sample: verified 0.1.0 -->
```js
// wallet.js: build and submit; `approveInIdentityPage` is the request round trip of step 2
async function sendTransfer(from, recipients, memo) {
  const draft = await net.build.transfer({
    from,
    to: recipients.map((r) => ({ address: Sdk.Address.parse(r.to, net), amount: Sdk.Amount.parse(r.amount, net.token.decimals) })),
    memo,
  });
  const signedBytes = await approveInIdentityPage({ kind: "transaction", draft: draft.serialize() });
  const signed = Sdk.SignedTransaction.deserialize(signedBytes, net.profile);
  if (!signed.matches(draft)) throw new Error("The signed transaction is not the transfer that was reviewed.");
  const result = await net.submit(signed);
  if (result.status !== "accepted") throw new Error("The network refused the transfer (" + result.reason + ").");
  return net.transactions.wait(signed.id, { until: "confirmed" });
}
```

### Votes

The basket holds percentages with two decimals. The vote carries whole basis points. Convert the text exactly, without floating point, and let `net.rules.vote` decide the limits:

<!-- sample: verified 0.1.0 -->
```js
// "4.76" -> 476; refuses more than two decimals
function basisPoints(percentText) {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(percentText).trim());
  if (!match) throw new Error("Use a percentage with at most two decimals.");
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function voteEntries(basket) {
  const entries = basket.map((item) => ({ validator: item.name, basisPoints: basisPoints(item.pct) }));
  const rules = net.rules.vote;
  const total = entries.reduce((sum, entry) => sum + entry.basisPoints, 0);
  if (entries.length && total !== rules.totalBasisPoints) throw new Error("Allocate exactly 100% of your vote.");
  if (entries.length > rules.maxEntries) throw new Error("A vote names at most " + rules.maxEntries + " validators.");
  return entries;   // net.build.vote checks the rest and throws InvalidVote with details
}
```

The basket's `shareMax()` comes from `net.rules.vote.maxBasisPointsPerEntry` (10,000 on today's devnet, so no cap; 500 from the IceRoot genesis).

### 8. Remove what the SDK replaces

After the tests pass on the SDK:

- delete `signing-protocol.js` (after moving the site rules to `site-policy.js`), `identity-crypto.js` and `_build-identity-crypto/`;
- remove them from `REQUIRED_FILES` (add `site-policy.js`), `index.html`, `identity.html` and `sandbox.html`;
- replace `tests/identity-crypto.test.mjs` with a test that the legacy import through the SDK gives the same address and signatures as the recorded outputs of the old bundle for a set of phrases.

The legacy signer keeps its own files. When the SDK's ownership-proof functions are released, it may move to them and drop `'unsafe-eval'` from its sandbox; that is optional.

## Rules that apply to the browser wallet

- The provider offers `connect` and `signMessage` only; transaction requests come only from the wallet's own page, never from a website ([rule 6](../rules.md)).
- Every sign-in message passes `SignIn.parse` before the holder sees an approval screen, with the real sender origin.
- Keys exist only in the sandbox, for one operation, and are released; the vault stays encrypted ([rule 12](../rules.md)).
- The approval screen shows the summary the sandbox recomputed from the draft's bytes ([rule 15](../rules.md)).
- Fees, decimals and vote limits come from the network ([rule 1](../rules.md)); amounts are `bigint` ([rule 2](../rules.md)).
- "Confirmed", never "final", on today's devnet ([rule 5](../rules.md)).

## Tests to add

- The existing Playwright extension tests, with WebAssembly loading in the wallet page, the sandbox (with `connect-src 'none'` kept) and the service worker.
- Sign-in end to end with the validators portal, both sides on the SDK.
- A transfer and a vote on a local devnet: built in the wallet page, signed in the sandbox, confirmed.
- The legacy identity test of step 8.
- A test that the service worker refuses a transaction request from a website origin.
