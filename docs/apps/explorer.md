# Integration guide: explorer

The explorer (`iceroot-network/explorer`) is a Next.js 15 frontend with a read-only Rust (Axum) API in `backend/`. Today the API serves a bundled sample ledger. After wiring, the API reads the devnet through the Rust SDK and serves the same resource endpoints from live data. The browser keeps reading the API; it needs no SDK and no WebAssembly.

Read first: [Concepts](../concepts.md), [Rules](../rules.md), [Rust backend quickstart](../quickstart/rust-backend.md), [Devnet](../devnet.md).

## What to wire now and what waits

| Part | Release 0.1.0 | Waits for |
|---|---|---|
| Blocks, transactions, validators, accounts, ROOT balances and supply, search | Wire now | |
| Vote contents on vote transactions (validators and shares) | Wire now | |
| The current round's forging order | Show the observed order (see below) | A node API field for the round's order |
| Assets other than ROOT, asset pages with origins, caps and holders | Hide | The assets release (capability `assets`) |
| Migrations and migration routes | Hide | Migration support (capability `migration-exit`) |
| Finality on blocks and transactions | Show "not final" wording only | Finality (capability `finality`) |
| Names with history, reward-sharing terms, validator declarations | Hide | The IceRoot genesis (capabilities `names`, `share-declare`) |
| Verified labels and look-alike warnings | Keep the app's own labels | The label lists release |

## The current sample-data layer

| File | Role today |
|---|---|
| `backend/data/fixtures.json` | The sample ledger: `explorer` (heights, validators, assets, transactions, migrations, labels), `migrations` (routes and states), `asset` (scenarios), `seedbed` (the Seedbed preview's defaults) |
| `backend/data/config.json` | Site configuration and status texts |
| `backend/src/lib.rs` | `include_str!` of both files; `ExplorerFixture` and friends; `build_collections` replays the ledger (balances, supplies, votes) and validates it; `minor_units` and `decimal_amount` convert amounts; `check_vote` and `valid_name` apply the vote and name rules to the sample; routes `/healthz`, `/api/v1/status`, `/api/v1/snapshot`, `/api/v1/config`, `/api/v1/{collection}`, `/api/v1/{collection}/{id}`, `/api/v1/search`; every response carries `meta: { mode: "demo", source: "bundled-fixtures", updatedAt: null }` |
| `app/api/v1/snapshot/route.ts` | Next.js proxy of `/api/v1/snapshot` to `EXPLORER_API_ORIGIN` |
| `lib/snapshot.ts` | `assertSnapshotResponse` checks the snapshot's shape and requires `meta.mode === "demo"` |
| `components/ExplorerController.jsx` | `loadSnapshot` fetches the snapshot once and renders everything from it |

## Mapping: sample field to SDK call

In Rust the call groups are methods: `net.blocks().latest().await`, `net.validators().list().await`, and so on.

| Sample field | SDK source | Notes |
|---|---|---|
| `explorer.latestHeight` | `blocks.latest()` `.height` | Refresh on each new block |
| `explorer.firstHeight` | The oldest block the API keeps in its window | A live explorer pages through history instead of holding all of it |
| `explorer.producersPerRound` | `economics.seats` | 53 |
| `explorer.validators.round` | The round of the latest height, from the SDK's round arithmetic | Round = the height's position in blocks of `seats` |
| `explorer.validators.list[]`: `rank`, `name`, `account`, `status`, `weightBp`, `voters` | `validators.list()`: `rank`, `name`, `address`, `status`, `voteWeightBasisPoints`, `voters` | Map `resigned-temporary` and `resigned-permanent` to the frontend's `resigned`. `voteWeight` is also available in base units |
| `explorer.validators.order` | Not available from the node API | See [Forging order](#forging-order) |
| `explorer.validators.missed[]` | `blocks.missed()` (the reference API's `/blocks/missed`), or per validator `validators.missed(name)` | Read the list once per round, not per validator |
| `explorer.assets[]` | `net.token` plus `economics.supply()` | One asset, ROOT, on today's devnet: id `AssetId.ROOT`, symbol, decimals, issued, burned, current supply |
| `explorer.txs[]` | `blocks.transactions(id)`, `transactions.get(id)`, `transactions.list(filter)` | `TxRecord`; see the kinds below |
| `explorer.labels` | App configuration | Keep the explorer's own labels until the verified label list exists |
| `explorer.migrations`, `migrations.routes`, `migrations.states` | None today | Hide the migration views while `net.capabilities.has("migration-exit")` is false |
| `asset.scenarios`, `asset.lookalike` | None | Explanatory content, not ledger data. Keep it as static page content, clearly illustrative, or drop it |
| `seedbed` | None | The Seedbed preview is a local tool; leave it as it is |
| Account balances and recorded vote | `accounts.get(address)`: `balances`, `nonce`, `vote`, `validator` | |
| Amount conversion (`minor_units`, `decimal_amount`) | `Amount::parse`, `Amount::format` with the asset's decimals | Decimal strings in the JSON the frontend reads |

Transaction kinds:

| Sample `type` | `TxRecord` | Frontend change |
|---|---|---|
| `transfer` (one recipient), `multi` (several) | `kind: "transfer"` with 1 to 256 `transfers` and one `memo` | Keep both displays; choose by the number of transfers. The sample's `ref` is the memo |
| `vote` with `votes: [{ validator, shareBp }]` | `kind: "vote"` with `vote: [{ validator, basisPoints }]`; empty withdraws | Rename `shareBp` to `basisPoints` or map it in the API |
| `create`, `migrate-in`, `migrate-out` | Not on today's devnet | Keep the renderers for later; they receive no data now |
| (none) | `burn`, `second-key`, `validator-registration`, `validator-resignation` | Add labels and detail rows for these four kinds |

## Wiring steps

### 1. Backend dependency and toolchain

- Add `iceroot-sdk` with the `http` feature (see [Installation](../installation.md#rust)) and `.cargo/config.toml` with `git-fetch-with-cli = true`.
- Raise `rust-version` in `backend/Cargo.toml` from 1.85 to 1.98, and the Rust image pinned in `backend/Dockerfile` (1.93.0 today) to 1.98 or later.
- In `backend/Dockerfile`, fetch git dependencies with `RUN --mount=type=ssh`, and build with `docker build --ssh default` (see the [Rust backend quickstart](../quickstart/rust-backend.md#5-docker)).
- New settings, next to `ICEROOT_API_BIND`: `ICEROOT_RELAY` (the devnet relay URL with `/api`), `ICEROOT_NETHASH` (the pinned devnet identity) and, for the hosted endpoint, the access token.

### 2. Replace the fixture store with a live cache

Remove `include_str!` of `fixtures.json` and the replay in `build_collections`. The `Store` becomes a cache filled from the network:

<!-- sample: pending; needs: rust:connect, rust:blocks().latest, rust:blocks().list, rust:blocks().transactions, rust:validators().list, rust:economics().supply, rust:blocks().missed -->
```rust
struct Store {
    net: iceroot_sdk::Network,
    cache: tokio::sync::RwLock<Cache>,
}

struct Cache {
    latest_height: u64,
    updated_at: Option<String>,               // the latest block's time, never the server's clock
    blocks: std::collections::VecDeque<Value>, // the newest blocks, for example the last two rounds
    transactions: BTreeMap<String, Value>,     // the transactions of those blocks
    validators: Vec<Value>,                    // refreshed once per round
    missed: Vec<Value>,                        // refreshed once per round
    supply: Value,
}

async fn refresh(store: &Store) -> Result<(), iceroot_sdk::Error> {
    let latest = store.net.blocks().latest().await?;
    // Fetch only blocks newer than the cache, with their transactions; drop the oldest beyond the window.
    // Refresh validators, missed slots and supply when the round changes.
    Ok(())
}
```

- Run `refresh` on a timer of one block time (`economics.block_time_seconds`, 8 seconds). The reference API allows about 100 requests per minute per client; one new block with its transactions costs two requests, and a round refresh a few more.
- Serve every endpoint from the cache. Requests for older blocks or transactions outside the window go to the network (`blocks().get(height)`, `transactions().get(id)`) and are cached.
- Build `status` and `health` from the cache: `chainConnected` is true only while the last refresh succeeded.
- Keep the existing API contract (paths, filters, pagination, error envelope, CORS) so the frontend and the documentation playground keep working.

### 3. Change the response metadata

Every response carries `meta`. Today it says `mode: "demo"`. For live data:

<!-- sample: plain -->
```json
{ "meta": { "mode": "live", "source": "node", "network": "devnet", "height": 20420, "updatedAt": "2026-10-01T12:00:08Z" } }
```

- `updatedAt` is the latest block's timestamp from the chain.
- When the network is unavailable, return `503` with the error envelope. Never serve the sample ledger or stale data as current. The frontend already shows an error and a retry.

### 4. Frontend changes

- `lib/snapshot.ts`: accept `meta.mode === "live"` and require `meta.network`. Keep rejecting anything else.
- `app/api/v1/snapshot/route.ts`: no change; it proxies whatever the API returns.
- No Content Security Policy or `next.config.ts` change: the browser loads no SDK and no WebAssembly.
- `components/ExplorerController.jsx`: the snapshot now holds a window of recent blocks, not a whole ledger. Load older blocks, account history and search results from the resource endpoints (`/api/v1/blocks?offset=...`, `/api/v1/accounts/{id}`, `/api/v1/search?q=...`) instead of from the snapshot.
- Show the network name ("Devnet") wherever the demo label is shown today.
- Show amounts with the asset's decimals from the API (8 for ROOT on today's devnet). Keep the exact integer arithmetic.
- Hide asset pages other than ROOT, and the migration and route views, while the API reports the capability as absent. Add `capabilities` to `/api/v1/status` from `net.capabilities` so the frontend can decide.

### 5. Search

`/api/v1/search?q=` recognises, in this order:

| Input | Check | Lookup |
|---|---|---|
| Digits only | A height up to the latest | `blocks().get(height)` |
| 64 hexadecimal characters | A block or transaction id | `transactions().get(id)`, then `blocks().get(id)` |
| An address | `Address::check(text, &profile)` is ok | `accounts().get(address)` |
| Lowercase letters | A validator name | `validators().get(name)` |

Never decide what an address is with a regular expression; the SDK checks the network byte and the checksum.

### Forging order

The explorer shows each round's forging order. The order is shuffled per round by the chain, and neither the reference API nor the SDK exposes it. Until a node API field provides it:

- Show the order observed so far in the current round: each block's slot comes from its timestamp, and its generator is the validator who forged it.
- Show missed slots from `blocks().missed()`.
- Do not recompute the shuffle in the explorer from Heartwood's consensus crates unless the explorer's maintainers accept that dependency; it is not part of the SDK.

## Rules that apply to the explorer

- Never show substitute data: an unavailable node is a `503` and an error screen ([rule 13](../rules.md)).
- Identify assets by asset id, never by symbol; keep the look-alike asset handling for when assets exist ([rule 3](../rules.md)).
- Amounts stay exact: integers in base units in the backend, decimal strings in JSON ([rule 2](../rules.md)).
- Say "confirmed" and show confirmations; never "final" on today's devnet ([rule 5](../rules.md)).
- Parse addresses against the devnet profile ([rule 4](../rules.md)).

## Tests to add

- API tests against recorded devnet responses: the SDK's mappers are tested upstream, so the explorer's tests check its own cache, pagination, filters and error handling.
- A test that the API answers `503`, and never sample data, when the relay is unreachable.
- One end-to-end run against a local devnet: the latest block and a known transfer appear in the frontend.
