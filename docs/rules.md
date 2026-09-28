# Rules apps must never get wrong

Every IceRoot app follows these rules. The SDK enforces what it can; the rest is the app's job. Each integration guide ends with the rules that apply to it.

| # | Rule | How the SDK helps |
|---|---|---|
| 1 | Never use a hard-coded fee, nonce, decimal count, vote limit or other network rule. Read them from the network | Drafts resolve fee and nonce online; `net.token.decimals`, `net.rules`, `net.economics` |
| 2 | Never compute amounts with floating point, and never add amounts of different assets | Amounts are `bigint` base units; `Amount.parse` and `Amount.format` take the asset's decimals |
| 3 | Identify assets by their asset id, never by their symbol. Show an issuer's description only when its hash matches the chain | `AssetId`; `assets.fetchMetadata(asset)` returns `verified` (from the release that adds assets) |
| 4 | Never treat a devnet or testnet address as a mainnet one, and never check an address with a regular expression | `Address.parse(text, net)` refuses another network with `wrong-network` |
| 5 | Show "final" only where the network has finality, and only once it is reached. Credit incoming funds and call a claim complete only when final, where finality exists | `net.capabilities.has("finality")`; `transactions.wait(id, { until: "final" })`; `status.state` |
| 6 | Never sign a transaction for a website. Sign only sign-in messages that pass every check | No such function exists; `SignIn.parse` |
| 7 | Never recast a vote automatically. Offer a new selection; the holder signs it | The vote library's `check` returns findings only ([Vote selection](vote.md)) |
| 8 | Never let a validator account vote, and never offer validator registration while the account votes (from the IceRoot genesis) | `net.build.vote` and `net.build.registerValidator` check the network's rules |
| 9 | Show the address next to every name, with the name's age and transfer count; warn before sending to a name with no verified label; warn when a saved name's address changed | Builders accept a resolved name, which always carries its address and record; `names.compare(saved, resolved)` (names release) |
| 10 | Show verified labels, flag look-alikes of verified names, hide names on the display blocklist, badge verified assets | `Labels.parse`, `VerifiedAssets.parse`, `names.lookalike(name, labels)` over the lists the apps fetch from iceroot.com (names and assets releases) |
| 11 | Follow the hash time lock order in cross-chain swaps; warn that a signed swap offer can be taken by anyone who holds it until it lapses | `Htlc.checkLockOrder`; offer drafts carry `expiresAtHeight` (assets and swaps release) |
| 12 | Never store a phrase or key in `localStorage`, `sessionStorage`, IndexedDB or an unencrypted file. Accept only 18 words or more for new keys | Keys are opaque handles; `PhraseTooShort`; the [keystore](keystore.md), whose bytes may be stored where the platform keeps secrets |
| 13 | Never show sample, cached or substitute data as if it were current. An unavailable node is an error state with a retry, not an empty list | Reads throw `NodeUnavailable`, `Timeout` or `BadResponse`; nothing is swallowed |
| 14 | Never switch networks silently. A changed chain identity is a new chain; ask the holder before pinning it | `connect` throws `NetworkMismatch` |
| 15 | Show exactly what will be signed, from the draft, on the review screen, and sign nothing the holder did not review. Build the draft from the sender's public key or address, and open the key only after the review | `draft.summary`; `Draft.deserialize` recomputes the summary from the bytes, so a signing context can compare it with the one the holder saw |
| 16 | Show text that comes from the chain (memos, names, addresses in records) without control or bidirectional characters | `draft.summary.lines` are escaped by the SDK; the app escapes the rest itself |
| 17 | Check the saved address against the derived one every time a wallet is reopened | `account.address`; `Keys.fromPhrase`, `Keys.fromKeystore` and `Keys.fromLegacyPassphrase` take a profile and need no network |

## Notes on the rules

- **Rule 1 and the current apps.** The apps hard-code 18 decimals, votes of 20 to 53 entries at 500 basis points at most, fixed fees and the portal calculator's reward constants. Today's devnet has 8 decimals, allows 1 to 53 entries with no per-validator cap, charges fees by size and has its own economics. A wallet may keep 20 picks at 500 basis points as its default vote, because that vote is valid under both rule sets; the limits it enforces and shows come from `net.rules.vote`.
- **Rule 5 today.** Today's devnet has no finality. Show confirmations and say "confirmed", never "final". Do not invent a number of confirmations that counts as final.
- **Rule 15 in one context and in two.** A wallet with one context signs the `Draft` object the review screen showed. A wallet with two (a Manifest V3 extension: the page builds and reviews, a sandbox signs) sends `draft.serialize()` to the signing context, which restores it with `Draft.deserialize(bytes, profile)` and shows the summary it recomputed. It signs only if that summary equals the one the holder approved, and `SignedTransaction.deserialize(bytes, profile)` restores the result on the page. `reviewDraft` and `signDraft` in the desktop wallet's `src/session.ts` are a worked example. Neither context needs the key to build: a public key or an address is enough, and an address works only once the account has sent a transaction.
- **Rule 16 and what the SDK escapes.** The lines of `draft.summary` write control characters, line and paragraph separators and bidirectional formatting characters as `\uXXXX`, and a backslash as `\\`. The SDK does not touch other chain text: history memos, validator names and `details.name` arrive as they are. Escape them the same way before showing them. `safeText` in the desktop wallet's `src/walletData.ts` is a worked example.
- **Rule 17 and the wrong key.** A wrong account or index, another wallet's phrase or a changed scheme each give a valid key of an address the holder never saw, and a draft signed with it is a different sender. The saved address is the check. Derive, compare, and release the key of another address before doing anything else.
- **Rule 13 and demos.** An app may keep a clearly labelled demo mode that reads its fixture. The live path never falls back to the fixture, and demo data never appears on a screen that reads the network.

## Security notes

- **What the SDK protects.** Keys live in Rust memory (WebAssembly memory in a browser, the Tauri plugin's memory in a Tauri app, where a key belongs to the webview that opened it) and are wiped by `release()`. Signing uses fresh randomness per signature and fails closed with `RandomnessUnavailable` if the host has no secure random source. Draft deserialization refuses another network.
- **What it cannot protect.** A compromised page, extension or webview can call the SDK like the app does. JavaScript strings cannot be wiped, so a phrase typed into a text field stays in memory until the page is gone; pass phrases as `Uint8Array` where you can and release keys promptly. WebAssembly under a JIT gives no constant-time guarantee; the desktop and mobile wallets sign natively, in the Tauri plugin.
- **Content Security Policy.** Loading WebAssembly needs `'wasm-unsafe-eval'` in `script-src`; a Tauri app on the plugin loads none and needs no change. It does not allow JavaScript `eval`. Never add `'unsafe-eval'` except as the documented fallback for old WebKit versions, and only where the quickstart says so.
- **Storage.** A wallet that keeps a recovery phrase across sessions keeps it as a [keystore](keystore.md), with its platform's preset, and never designs a vault of its own. The desktop and mobile wallets keep it with the Tauri plugin, which runs the format natively and opens accounts from it without the phrase entering the page. Devnet keys hold no value, so the browser wallet may keep its current encrypted storage until it moves to the keystore, once.

## Checklist for a review

- [ ] No fee, nonce, decimal count, vote limit, reward figure or supply is a constant in the app.
- [ ] Every amount is a `bigint` or a decimal string of base units; no `Number` holds an amount.
- [ ] Every address a user types is checked with `Address.check` or `Address.parse` against the connected network.
- [ ] Features whose capability is absent are hidden, not shown as errors.
- [ ] The review screen renders `draft.summary` and `draft.fee`, and the key is opened only after it.
- [ ] Drafts are built from a public key or an address; a signing context in another page compares the reviewed summary with the one it recomputes.
- [ ] Memos, names and other chain text are escaped before they are shown.
- [ ] A reopened wallet's derived address is compared with the saved one.
- [ ] No screen says "final" unless `net.capabilities.has("finality")` and the state is `final`.
- [ ] Node failures show an error and a retry; nothing falls back to sample data.
- [ ] No phrase or key reaches storage unencrypted; key handles are released after use.
- [ ] Website-facing code offers `connect` and `signMessage` only, and runs `SignIn.parse` first.
