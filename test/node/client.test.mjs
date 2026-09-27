// The node API client through WebAssembly, against responses recorded from a local devnet: connect
// and the chain's identity, every read, the transport (relays, headers, timeouts, the request
// budget, HTTP 429), submission within the pool's limits, waiting for inclusion, and builders that
// read a draft's facts from the node.
//
// The recordings are the node API client's own fixtures in sdk-rust (next to this repository, as
// for the build), so the TypeScript client and the Rust mappers are tested on the same answers.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as sdk from "../../dist/node/index.js";
import { root } from "./helpers.mjs";

const FIXTURES = join(root, "..", "sdk-rust", "crates", "iceroot-sdk-api", "tests", "fixtures", "devnet");
if (!existsSync(join(FIXTURES, "index.json"))) {
  throw new Error(`the recorded devnet answers are missing: check out sdk-rust next to this repository (${FIXTURES})`);
}
const INDEX = JSON.parse(readFileSync(join(FIXTURES, "index.json"), "utf8"));
const RELAY = "http://127.0.0.1:4003/api";
const NETHASH = JSON.parse(readFileSync(join(FIXTURES, "node-configuration.json"), "utf8")).data.nethash;
const TWO_RECIPIENTS = "b2abe2cabab608935280c144a15ebea3e4e8348c530a983ffbf6013a13ab54a9";
const GENESIS_1 = "dZ1W1GsDCSyhR148oMhuHy3PkhnnSGCqVn";
const TEAM = "daTBxkSJk2tZhujYcYSQtxj5RRFZ8HcxW8";
const SECOND_KEY = { address: "dDsmrDBibyfMtDreqHVTNix1sixL74Km2P", publicKey: "025e1a3fea8d4763b6898ced2e356047d334f11cf3c799ea22b02848f608c729b1" };

function fixture(name) {
  const entry = INDEX.find((each) => each.name === name);
  assert.ok(entry, name);
  return {
    status: entry.status,
    headers: entry.headers ?? {},
    body: readFileSync(join(FIXTURES, entry.file), "utf8"),
    request: entry.requestFile ? JSON.parse(readFileSync(join(FIXTURES, entry.requestFile), "utf8")) : undefined,
  };
}

const json = (status, body, headers = {}) => ({ status, headers, body: JSON.stringify(body) });

/**
 * A node that answers from the recordings. `routes` maps `METHOD /path` (without the base path
 * and query) to a fixture name, an answer, or a function of the request returning one; anything
 * else is the first recording of that method and path. Every request is recorded in `requests`.
 */
function recordedNode(routes = {}) {
  const requests = [];
  const transport = async (url, init = {}) => {
    const parsed = new URL(url);
    assert.ok(parsed.pathname.startsWith("/api/"), url);
    const path = parsed.pathname.slice("/api".length);
    const method = init.method ?? "GET";
    const request = { url, method, path, query: parsed.searchParams, headers: init.headers, body: init.body };
    requests.push(request);
    let answer = routes[`${method} ${path}`];
    if (typeof answer === "function") {
      answer = answer(request);
    }
    if (typeof answer === "string") {
      answer = fixture(answer);
    }
    if (answer === undefined) {
      const entry = INDEX.find((each) => each.method === method && each.path.split("?")[0] === path);
      if (entry === undefined) {
        const wallet = /^\/wallets\/(d[1-9A-HJ-NP-Za-km-z]{33})$/.exec(path);
        answer = wallet
          ? json(200, { data: { address: wallet[1], balance: "0", nonce: "0", attributes: {}, votingFor: {} } })
          : json(404, { statusCode: 404, error: "Not Found", message: `no recording of ${method} ${path}` });
      } else {
        answer = fixture(entry.name);
      }
    }
    return new Response(answer.status === 204 ? null : answer.body, {
      status: answer.status,
      headers: { "content-type": "application/json", ...answer.headers },
    });
  };
  return { transport, requests };
}

const devnet = (options = {}) => sdk.profiles.devnet({ relays: [RELAY], ...options });

async function connected(routes, options = {}) {
  const node = recordedNode(routes);
  const net = await sdk.connect(devnet(), { transport: node.transport, rateLimit: false, ...options });
  return { net, node };
}

test("connect loads the chain, pins its identity and follows the node's height", async () => {
  const { net, node } = await connected();
  assert.ok(net instanceof sdk.Network);
  assert.equal(net.profile.chain.nethash, NETHASH);
  assert.equal(net.chain.nethash, NETHASH);
  assert.deepEqual(
    node.requests.map((request) => `${request.method} ${request.path}`),
    ["GET /node/configuration/crypto", "GET /node/configuration", "GET /node/status"],
  );
  assert.equal(net.height, 80n);
  assert.equal(net.nextHeight, 81);
  assert.equal(net.stage, "s1");
  assert.equal(net.token.assetId, sdk.AssetId.ROOT);
  assert.equal(net.token.decimals, 8);
  assert.equal(net.rules.height, 81);
  assert.equal(net.rules.memo.maxBytes, 255);
  assert.equal(net.rules.transfer.maxRecipients, 256);
  assert.equal(net.economics.seats, 53);
  assert.equal(net.economics.blockTimeSeconds, 8);
  assert.equal(net.capabilities.has("transfer"), true);
  assert.equal(net.capabilities.has("finality"), false);
  assert.equal(net.configuration.pool.maxTransactionsPerRequest, 40);
  assert.equal(net.configuration.pool.maxTransactionBytes, 2_000_000);
  assert.equal(net.configuration.poolFees.minFeePool, 6173n);
  assert.deepEqual(net.configuration.poolFees.addonBytes[0], { kind: "other", typeGroup: 1, typeId: 0, bytes: 99n });
  assert.deepEqual(
    net.configuration.poolFees.addonBytes.find((entry) => entry.kind === "transfer"),
    { kind: "transfer", bytes: 85n },
  );

  // A pinned profile connects again; another chain is refused.
  const again = await sdk.connect(net.profile, { transport: node.transport, rateLimit: false });
  assert.equal(again.profile.chain.nethash, NETHASH);
  await assert.rejects(
    sdk.connect(devnet({ nethash: "ab".repeat(32) }), { transport: node.transport, rateLimit: false }),
    sdk.NetworkMismatch,
  );
  const moved = JSON.parse(fixture("node-configuration").body);
  moved.data.nethash = "cd".repeat(32);
  await assert.rejects(
    connected({ "GET /node/configuration": json(200, moved) }),
    (error) => error instanceof sdk.NetworkMismatch && error.details.actual === "cd".repeat(32),
  );
  assert.equal((await net.node.configuration()).seats, 53);

  // The height follows every answer's X-Block-Height, so the rules follow the chain.
  await net.transactions.get(TWO_RECIPIENTS);
  assert.equal(net.height, 82n);
  assert.equal(net.rules.height, 83);
});

test("connect refuses what it cannot use", async () => {
  const node = recordedNode();
  const later = { ...devnet(), id: "idDevnet", backend: "iceroot", keyScheme: "slip10-mldsa65" };
  await assert.rejects(sdk.connect(later, { transport: node.transport }), sdk.UnsupportedOnNetwork);
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: Number.NaN }, { rateLimit: { requests: 0, windowMs: 1 } }, { rateLimit: { requests: 1, windowMs: -1 } }]) {
    await assert.rejects(sdk.connect(devnet(), { transport: node.transport, ...options }), sdk.InvalidArgument, JSON.stringify(options));
  }
  await assert.rejects(
    sdk.connect(sdk.profiles.devnet({ relays: ["http://user:secret@127.0.0.1:4003/api"] }), { transport: node.transport }),
    sdk.InvalidRequest,
  );
  const saved = globalThis.fetch;
  globalThis.fetch = node.transport;
  try {
    const net = await sdk.connect(devnet(), { rateLimit: false });
    assert.equal(net.height, 80n);
  } finally {
    globalThis.fetch = saved;
  }
});

test("accounts, histories and transactions are typed records", async () => {
  const { net, node } = await connected();

  const genesis = await net.accounts.get(GENESIS_1);
  assert.equal(genesis.address, GENESIS_1);
  assert.equal(typeof genesis.nonce, "bigint");
  assert.equal(genesis.balances.length, 1);
  assert.equal(genesis.balances[0].asset, sdk.AssetId.ROOT);
  assert.equal(sdk.balanceOf(genesis), genesis.balances[0].amount);
  assert.equal(sdk.balanceOf(genesis, "ab".repeat(32)), 0n);
  const second = await net.accounts.get(sdk.Address.parse(SECOND_KEY.address, net));
  assert.equal(second.secondPublicKey, "0318b677beadb87f35e29150a9bfdb20e1bb934bd70f1208383f4bff7ad6be5d67");
  assert.deepEqual(second.vote, [{ validator: "genesis_14", basisPoints: 10_000 }]);
  assert.equal("validatorName" in second, false);
  const cold = await net.accounts.get("dW84xVtbupBGDKm73pewS4hqhDqcJoyhzv");
  assert.equal(cold.nonce, 0n);
  assert.equal("publicKey" in cold, false);
  await assert.rejects(net.accounts.get("nobody-at-all"), (error) => error instanceof sdk.Refused && error.details.status === 422);

  const history = await net.history.forAccount(TEAM, { direction: "sent", page: 1, limit: 10 });
  const last = node.requests.at(-1);
  assert.equal(last.path, `/wallets/${TEAM}/transactions/sent`);
  assert.equal(last.query.get("page"), "1");
  assert.equal(last.query.get("limit"), "10");
  assert.equal(last.query.get("orderBy"), "timestamp:desc");
  assert.equal(typeof history.total, "bigint");
  assert.equal(typeof history.hasNext, "boolean");
  assert.ok(history.items.length > 0);
  for (const record of history.items) {
    assert.ok(["sent", "to-self"].includes(record.direction), record.direction);
    assert.equal(typeof record.fee, "bigint");
  }
  const votes = await net.history.votes("dTe1ruBESG2r63u3VCLrMpTcx18PSurKJJ");
  assert.ok(votes.items.every((record) => record.details.kind === "vote"));

  const transfer = await net.transactions.get(TWO_RECIPIENTS);
  assert.equal(transfer.id, TWO_RECIPIENTS);
  assert.equal(transfer.status, "confirmed");
  assert.equal(transfer.block.height, 82n);
  assert.equal(transfer.block.confirmations, 1n);
  assert.equal(transfer.block.time.unix, 1790484455n);
  assert.equal(transfer.details.kind, "transfer");
  assert.deepEqual(transfer.details.recipients, [
    { address: GENESIS_1, amount: 1_000_000_000n },
    { address: "dMVgdVMdEWR2rVH6RRgXqheywVTzbgLNyG", amount: 2_000_000_000n },
  ]);
  assert.equal(transfer.nonce, 1n);
  assert.equal(transfer.burnedFee, 1_800_000n);
  assert.equal(transfer.memo, "fixture: two recipients");
  assert.equal("direction" in transfer, false);

  const pending = await net.transactions.pending(TWO_RECIPIENTS);
  assert.equal(pending.status, "pending");
  assert.equal("block" in pending, false);
  const missing = "00".repeat(32);
  assert.equal(await net.transactions.get(missing), null);
  assert.deepEqual(
    node.requests.slice(-2).map((request) => request.path),
    [`/transactions/${missing}`, `/transactions/unconfirmed/${missing}`],
  );
  const inPoolOnly = await connected({ [`GET /transactions/${TWO_RECIPIENTS}`]: "transaction-not-found" });
  assert.equal((await inPoolOnly.net.transactions.get(TWO_RECIPIENTS)).status, "pending");

  const byKind = await net.transactions.list({ kind: "vote", sender: TEAM, oldestFirst: true, page: 1, limit: 5 });
  const listing = node.requests.at(-1);
  assert.equal(listing.query.get("typeGroup"), "2");
  assert.equal(listing.query.get("type"), "2");
  assert.equal(listing.query.get("senderId"), TEAM);
  assert.equal(listing.query.get("orderBy"), "timestamp:asc");
  assert.ok(Array.isArray(byKind.items));
  await net.transactions.list({ kind: "other", typeGroup: 1, typeId: 0 });
  assert.equal(node.requests.at(-1).query.get("type"), "0");
  await assert.rejects(net.transactions.list({ kind: "other" }), sdk.InvalidArgument);
  const pool = await net.transactions.pool({ limit: 10 });
  assert.equal(pool.page, 1);
  assert.ok(pool.items.every((record) => record.status === "pending"));

  const kinds = new Set();
  for (const name of ["transaction-vote", "transaction-burn", "transaction-second-key", "transaction-validator-registration", "transaction-resignation-temporary"]) {
    const other = await connected({ [`GET /transactions/${TWO_RECIPIENTS}`]: name });
    const record = await other.net.transactions.confirmed(TWO_RECIPIENTS);
    kinds.add(record.details.kind);
    if (record.details.kind === "burn") {
      assert.equal(typeof record.details.amount, "bigint");
    }
    if (record.details.kind === "resign-validator") {
      assert.equal(record.details.resignation, "temporary");
    }
    if (record.details.kind === "vote") {
      assert.ok(record.details.entries.every((entry) => Number.isInteger(entry.basisPoints)));
    }
  }
  assert.deepEqual([...kinds].sort(), ["burn", "register-second-key", "register-validator", "resign-validator", "vote"]);
});

test("blocks, validators, rounds, names, fees and supply", async () => {
  const { net, node } = await connected();

  const latest = await net.blocks.latest();
  assert.equal(typeof latest.height, "bigint");
  assert.equal(typeof latest.reward, "bigint");
  assert.ok(Array.isArray(latest.donations));
  const genesis = await net.blocks.genesis();
  assert.equal(genesis.height, 1n);
  assert.equal("previous" in genesis, false);
  const block = await net.blocks.get(82);
  assert.equal(block.height, 82n);
  assert.equal(node.requests.at(-1).path, "/blocks/82");
  await net.blocks.get(82n);
  assert.equal(node.requests.at(-1).path, "/blocks/82");
  const byId = await net.blocks.get(block.id);
  assert.equal(byId.id, block.id);
  assert.equal(await net.blocks.get(99_999_999), null);
  const transactions = await net.blocks.transactions(block.id, { limit: 10 });
  assert.ok(transactions.items.length > 0);
  const missed = await net.blocks.missed({ limit: 10 });
  for (const slot of missed.items) {
    assert.equal(typeof slot.height, "bigint");
    assert.equal(typeof slot.validator, "string");
  }
  const blocks = await net.blocks.list({ limit: 5 });
  assert.equal(blocks.items.length, 5);

  const validators = await net.validators.list();
  assert.equal(node.requests.at(-1).query.get("page"), "1");
  assert.equal(node.requests.at(-1).query.get("limit"), "100");
  assert.ok(validators.items.length > 0);
  const first = validators.items[0];
  assert.equal(first.rank, 1);
  assert.equal(first.status, "active");
  assert.equal(typeof first.voteWeight, "bigint");
  assert.equal(typeof first.voters, "bigint");
  assert.equal(typeof first.production.produced, "bigint");
  assert.equal(typeof first.earnings.total, "bigint");
  assert.ok(Number.isInteger(first.voteShareBasisPoints));
  const one = await net.validators.get("genesis_5");
  assert.equal(one.name, "genesis_5");
  assert.equal(await net.validators.get("no_such_validator"), null);
  const resigned = await net.validators.get("genesis_53");
  assert.equal(resigned.status, "resigned-temporary");
  assert.equal(resigned.rank, 4, "the node keeps ranking a temporarily resigned validator");
  const unranked = await connected({ "GET /delegates/genesis_5": "delegate-unranked" });
  assert.equal("rank" in (await unranked.net.validators.get("genesis_5")), false);
  const voters = await net.validators.voters("genesis_15", { limit: 10 });
  assert.ok(voters.items.every((voter) => voter.vote.some((entry) => entry.validator === "genesis_15")));
  const produced = await net.validators.blocks("genesis_5", { limit: 3 });
  assert.ok(produced.items.every((each) => each.producerName === "genesis_5"));
  await net.validators.missed("genesis_5", { limit: 10 });
  assert.equal(node.requests.at(-1).path, "/delegates/genesis_5/blocks/missed");

  const round = await net.rounds.validators(1);
  assert.equal(round.length, 53);
  assert.equal(typeof round[0].voteWeight, "bigint");
  assert.throws(() => net.rounds.validators(0), sdk.InvalidArgument);

  const name = await net.names.resolve("genesis_5");
  assert.deepEqual(Object.keys(name), ["name", "address", "publicKey"]);
  assert.equal(await net.names.resolve("no_such_validator"), null);

  const fees = await net.fees.statistics();
  const transfer = fees.entries.find((entry) => entry.kind === "transfer");
  assert.equal(typeof transfer.min, "bigint");
  await net.fees.statistics({ days: 30 });
  assert.equal(node.requests.at(-1).query.get("days"), "30");
  await assert.rejects(net.fees.statistics({ days: 31 }), sdk.InvalidRequest);

  const supply = await net.economics.supply();
  assert.equal(typeof supply.supply, "bigint");
  assert.equal(typeof supply.burned.total, "bigint");
  const status = await net.node.status();
  assert.equal(status.height, 80n);
  assert.equal(status.synced, true);
  const crypto = await net.node.cryptoConfiguration();
  assert.equal(crypto.nethash, NETHASH);
  assert.equal(JSON.parse(crypto.genesisBlockJson).height, 1);
});

test("the transport sends the SDK's and the app's headers to the relay's base path", async () => {
  const { net, node } = await connected({}, { headers: { authorization: "Bearer devnet-token" } });
  await net.accounts.get(GENESIS_1);
  const request = node.requests.at(-1);
  assert.equal(request.url, `${RELAY}/wallets/${GENESIS_1}`);
  assert.equal(request.headers.authorization, "Bearer devnet-token");
  assert.equal(request.headers.Accept, "application/json");
});

test("relays are tried in order, and an unavailable network is an error", async () => {
  const node = recordedNode();
  const tried = [];
  const transport = async (url, init) => {
    tried.push(new URL(url).host);
    if (url.startsWith("http://down.example")) {
      throw new TypeError("fetch failed");
    }
    if (url.startsWith("http://busy.example")) {
      return new Response(JSON.stringify({ statusCode: 503, error: "Service Unavailable", message: "busy" }), { status: 503 });
    }
    return node.transport(url.replace(/^http:\/\/[^/]+/, "http://127.0.0.1:4003"), init);
  };
  const profile = sdk.profiles.devnet({ relays: ["http://down.example/api", "http://busy.example/api", RELAY] });
  const net = await sdk.connect(profile, { transport, rateLimit: false });
  assert.deepEqual(tried.slice(0, 3), ["down.example", "busy.example", "127.0.0.1:4003"]);
  assert.equal(net.height, 80n);

  const nowhere = sdk.profiles.devnet({ relays: ["http://down.example/api"] });
  await assert.rejects(sdk.connect(nowhere, { transport, rateLimit: false }), (error) => {
    assert.ok(error instanceof sdk.NodeUnavailable);
    assert.ok(error.cause instanceof TypeError);
    return true;
  });
  const busy = sdk.profiles.devnet({ relays: ["http://busy.example/api"] });
  await assert.rejects(sdk.connect(busy, { transport, rateLimit: false }), (error) => error instanceof sdk.Refused && error.details.status === 503);

  const silent = () => new Promise(() => {});
  const started = Date.now();
  await assert.rejects(sdk.connect(devnet(), { transport: silent, timeoutMs: 50 }), sdk.Timeout);
  assert.ok(Date.now() - started < 2_000);
});

test("the request budget spaces requests, and HTTP 429 is retried after the backoff", async () => {
  const { net } = await connected({}, { rateLimit: { requests: 3, windowMs: 400 } });
  // connect spent the three requests of the window; the next one waits for it to pass.
  const started = Date.now();
  await net.node.status();
  assert.ok(Date.now() - started >= 250, `${Date.now() - started} ms`);

  let limited = 0;
  const { net: busy, node } = await connected({
    "GET /node/status": () => (limited-- > 0 ? "rate-limited" : "node-status"),
  });
  limited = 1;
  const before = node.requests.length;
  const retried = Date.now();
  await busy.node.status();
  assert.equal(node.requests.length - before, 2);
  assert.ok(Date.now() - retried >= 1_900, "the first retry waits 2 s");

  const always = await connected({ "GET /blocks/last": "rate-limited" });
  const backoff = always.net.blocks.latest();
  await assert.rejects(backoff, sdk.RateLimited);
});

test("submissions keep to the pool's limits and report every outcome in order", async () => {
  const mixed = fixture("submit-mixed").request.transactions;
  const accepted = fixture("submit-accepted").request.transactions;
  const { net, node } = await connected({ "POST /transactions": "submit-mixed" });
  const signed = mixed.map((tx) => sdk.SignedTransaction.fromJson(net.chain, tx, 81));
  const report = await net.submitAll(signed);
  assert.deepEqual(
    report.outcomes.map((outcome) => [outcome.id, outcome.status, outcome.reason ?? null, outcome.nodeCode ?? null]),
    [
      [signed[0].id, "accepted", null, null],
      [signed[1].id, "rejected", "low-fee", "ERR_LOW_FEE"],
      [signed[2].id, "rejected", "nonce", "ERR_APPLY"],
      [signed[3].id, "rejected", "balance", "ERR_APPLY"],
      [signed[4].id, "rejected", "invalid", "ERR_BAD_DATA"],
      [signed[5].id, "rejected", "duplicate", "ERR_COOLDOWN"],
    ],
  );
  // The fifth transaction's signature was corrupted when recorded: its id is the one its bytes
  // give, not the one its JSON claimed, and the node's refusal still maps to it.
  assert.notEqual(signed[4].id, mixed[4].id);
  assert.equal(signed[4].verified, false);
  const posted = node.requests.at(-1);
  assert.equal(posted.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(posted.body).transactions.map((tx) => tx.id), signed.map((tx) => tx.id));

  const single = await connected({ "POST /transactions": "submit-accepted" });
  const outcome = await single.net.submit(sdk.SignedTransaction.fromJson(single.net.chain, accepted[0], 81));
  assert.deepEqual(outcome, { id: accepted[0].id, status: "accepted", broadcast: true });

  // A pool that takes two transactions per request and 200 bytes per transaction.
  const small = JSON.parse(fixture("node-configuration").body);
  small.data.pool.maxTransactionsPerRequest = 2;
  const sizes = signed.map((tx) => tx.bytes.length);
  small.data.pool.maxTransactionBytes = Math.max(...sizes.slice(0, 5));
  const bigger = sdk.SignedTransaction.fromJson(net.chain, { ...mixed[5], memo: "x".repeat(120) }, 81);
  assert.ok(bigger.bytes.length > small.data.pool.maxTransactionBytes);
  const batches = [];
  const limited = await connected({
    "GET /node/configuration": json(200, small),
    "POST /transactions": (request) => {
      const ids = JSON.parse(request.body).transactions.map((tx) => tx.id);
      batches.push(ids);
      return json(200, { data: { accept: ids, broadcast: [], excess: [], invalid: [] } });
    },
  });
  const all = [...signed.slice(0, 5), bigger];
  const result = await limited.net.submitAll(all);
  assert.deepEqual(batches.map((batch) => batch.length), [2, 2, 1]);
  assert.deepEqual(result.outcomes.map((each) => each.id), all.map((tx) => tx.id));
  assert.ok(result.outcomes.slice(0, 5).every((each) => each.status === "accepted" && each.broadcast === false));
  assert.equal(result.outcomes[5].status, "rejected");
  assert.equal(result.outcomes[5].reason, "too-large");

  const refused = await connected({ "POST /transactions": "submit-empty" });
  await assert.rejects(refused.net.submit(signed[0]), (error) => error instanceof sdk.Refused && error.details.status === 422);
});

test("waiting follows a transaction from the pool into a block", async () => {
  let polls = 0;
  const { net } = await connected({
    [`GET /transactions/${TWO_RECIPIENTS}`]: () => (polls++ < 2 ? "transaction-not-found" : "transaction-transfer-two-recipients"),
  });
  const progress = [];
  const result = await net.transactions.wait(TWO_RECIPIENTS, { intervalMs: 5, onProgress: (step) => progress.push(step.state) });
  assert.equal(result.state, "confirmed");
  assert.equal(result.confirmations, 1n);
  assert.equal(result.record.block.height, 82n);
  assert.deepEqual(progress, ["pending", "pending"]);

  await assert.rejects(
    net.transactions.wait(TWO_RECIPIENTS, { confirmations: 2, intervalMs: 5, timeoutMs: 40 }),
    (error) => error instanceof sdk.Timeout && error.details.state === "confirmed",
  );
  await assert.rejects(net.transactions.wait(TWO_RECIPIENTS, { until: "final" }), (error) => {
    assert.ok(error instanceof sdk.UnsupportedOnNetwork);
    assert.equal(error.capability, "finality");
    return true;
  });
  await assert.rejects(net.transactions.wait(TWO_RECIPIENTS, { confirmations: 0 }), sdk.InvalidArgument);

  const gone = "11".repeat(32);
  const dropped = await net.transactions.wait(gone, { intervalMs: 5, droppedAfterMs: 20 });
  assert.deepEqual(dropped, { state: "dropped", id: gone });

  const stuck = await connected({ [`GET /transactions/${TWO_RECIPIENTS}`]: "transaction-not-found" });
  await assert.rejects(
    stuck.net.transactions.wait(TWO_RECIPIENTS, { intervalMs: 5, timeoutMs: 30 }),
    (error) => error instanceof sdk.Timeout && error.details.state === "pending",
  );
  const controller = new AbortController();
  const waiting = stuck.net.transactions.wait(TWO_RECIPIENTS, { intervalMs: 1_000, signal: controller.signal });
  setTimeout(() => controller.abort(new Error("stop")), 20);
  await assert.rejects(waiting, /stop/);
});

test("builders read the sender's nonce, the height and the second key from the node", async () => {
  const { net, node } = await connected();
  const phrase = sdk.Mnemonic.generate();
  const account = net.keys.fromPhrase(phrase, { account: 0, index: 0 });
  const recipient = net.keys.fromPhrase(phrase, { account: 0, index: 1 });
  try {
    const draft = await net.build.transfer({
      from: account,
      to: [{ address: recipient.address, amount: sdk.Amount.parse("1.5", net.token.decimals) }],
      memo: "invoice 42",
      fee: 1_000_000n,
    });
    assert.equal(draft.nonce, 1n);
    assert.equal(draft.height, 81);
    assert.equal(draft.fee, 1_000_000n);
    assert.equal(draft.summary.from, account.address);
    assert.equal(draft.summary.fee.source, "explicit");
    assert.ok(node.requests.some((request) => request.path === `/wallets/${account.address}`));
    assert.ok(!node.requests.some((request) => request.path === "/node/fees"), "an exact fee needs no statistics");
    const signed = draft.sign(account);
    assert.equal(signed.verified, true);

    // The default fee is the exact floor; the node's fee statistics are never read for it.
    const vote = await net.build.vote({ from: account.publicKey, entries: [{ validator: "genesis_5", basisPoints: 10_000 }] });
    assert.equal(net.rules.fees.floorAvailable, true);
    assert.equal(vote.summary.fee.source, "floor");
    assert.equal(vote.fee, vote.summary.fee.floor);
    assert.ok(vote.fee > 0n);
    const burn = await net.build.burn({ from: account, amount: 200_000_000n, fee: { multiplierBasisPoints: 15_000 } });
    assert.equal(burn.kind, "burn");
    const withdraw = await net.build.vote({ from: account, entries: [], fee: 1_000_000n });
    assert.deepEqual(withdraw.summary.operation, { kind: "vote", entries: [] });
    const secondKey = await net.build.registerSecondKey({ from: account, secondKey: recipient, fee: 500_000_000n });
    assert.equal(secondKey.summary.operation.publicKey, recipient.publicKey);
    const registration = await net.build.registerValidator({ from: account, name: "bergschrund", fee: 2_500_000_000n });
    assert.equal(registration.kind, "register-validator");
    const resignation = await net.build.resignValidator({ from: account, resignation: "temporary", fee: 2_500_000_000n });
    assert.equal(resignation.summary.operation.resignation, "temporary");
    assert.ok(!node.requests.some((request) => request.path === "/node/fees"), "no fee is read from the node's statistics");
  } finally {
    account.release();
    recipient.release();
  }

  // An account with a second key and four transactions: the draft takes nonce 5 and needs both keys.
  const twoKeys = await net.build.transfer({ from: SECOND_KEY.publicKey, to: [{ address: GENESIS_1, amount: 1n }], fee: 1_000_000n });
  assert.equal(twoKeys.nonce, 5n);
  assert.equal(twoKeys.summary.secondSignature, true);
  // By address: the node knows the key of an account that has sent a transaction...
  const reads = node.requests.length;
  const byAddress = await net.build.transfer({ from: SECOND_KEY.address, to: [{ address: GENESIS_1, amount: 1n }], fee: 1_000_000n });
  assert.equal(byAddress.summary.publicKey, SECOND_KEY.publicKey);
  assert.equal(byAddress.nonce, 5n);
  assert.equal(node.requests.slice(reads).filter((request) => request.path.startsWith("/wallets/")).length, 1);
  // ...but not of one that never has.
  await assert.rejects(
    net.build.transfer({ from: "dW84xVtbupBGDKm73pewS4hqhDqcJoyhzv", to: [{ address: GENESIS_1, amount: 1n }], fee: 1_000_000n }),
    sdk.InvalidArgument,
  );
  await assert.rejects(net.build.transfer({ from: "not an address", to: [], fee: 1n }), sdk.InvalidAddress);

  // The node reports another key for the sender's address: refused before anything is signed.
  const other = await connected({
    [`GET /wallets/${SECOND_KEY.address}`]: json(200, {
      data: { address: SECOND_KEY.address, publicKey: "03" + "11".repeat(32), balance: "1", nonce: "1", attributes: {}, votingFor: {} },
    }),
  });
  await assert.rejects(
    other.net.build.transfer({ from: SECOND_KEY.publicKey, to: [{ address: GENESIS_1, amount: 1n }], fee: 1_000_000n }),
    sdk.WrongKey,
  );
  await assert.rejects(net.build.transfer({ from: "02" + "zz".repeat(32), to: [], fee: 1n }), sdk.InvalidAddress);

  const legacy = net.keys.fromLegacyPassphrase("probe passphrase");
  const signature = net.messages.sign(legacy, "hello");
  assert.equal(sdk.Messages.verify({ ...signature, message: "hello" }, net), true);
  legacy.release();
});

test("watch-only accounts, and watching blocks and an account's transactions", async () => {
  const history = JSON.parse(fixture("wallet-transactions").body);
  assert.ok(history.data.length >= 3);
  let height = 80;
  let failing = false;
  let historyReads = 0;
  const { net, node } = await connected({
    "GET /node/status": () =>
      failing
        ? json(503, { statusCode: 503, error: "Service Unavailable", message: "down" })
        : json(200, { data: { synced: true, now: height, blocksCount: 0, timestamp: 634 } }),
    [`GET /wallets/${TEAM}/transactions`]: () => {
      historyReads += 1;
      // Before the height moves, the two newest transactions are not in a block yet.
      return json(200, height === 80 ? { ...history, data: history.data.slice(2) } : history);
    },
  });

  const watched = net.keys.watch(TEAM);
  assert.deepEqual(watched, { address: TEAM, watchOnly: true });
  assert.ok(Object.isFrozen(watched));
  assert.equal(net.keys.watch(sdk.Address.parse(GENESIS_1, net)).address, GENESIS_1);
  assert.throws(() => net.keys.watch("dAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), sdk.InvalidAddress);
  assert.throws(() => net.watch({ address: "not an address" }, () => {}), sdk.InvalidAddress);

  const events = [];
  const until = async (condition) => {
    for (let i = 0; i < 500 && !condition(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(condition(), JSON.stringify(events.map((event) => event.type)));
  };
  const stop = net.watch({ address: watched }, (event) => events.push(event), { intervalMs: 10 });

  // The first poll only notes where the chain and the account stand.
  await until(() => historyReads === 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(events, []);

  // The height moves: the latest block, then the account's two new transactions, oldest first.
  height = 81;
  await until(() => events.length === 3);
  const [block, older, newer] = events;
  assert.equal(block.type, "block");
  assert.equal(block.block.id, JSON.parse(fixture("blocks-last").body).data.id);
  assert.deepEqual(
    [older.type, older.transaction.id, newer.type, newer.transaction.id],
    ["transaction", history.data[1].id, "transaction", history.data[0].id],
  );
  assert.equal(typeof older.transaction.nonce, "bigint");

  // A failing poll is an event, and the watch goes on.
  failing = true;
  await until(() => events.length >= 4);
  assert.equal(events[3].type, "error");
  assert.ok(events[3].error instanceof sdk.IceRootError, String(events[3].error));
  failing = false;
  height = 82;
  await until(() => events.some((event, index) => index > 3 && event.type === "block"));
  assert.equal(events.filter((event) => event.type === "transaction").length, 2, "no transaction is reported twice");

  // Stopped: no more requests.
  stop();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const count = node.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(node.requests.length, count);

  // A signal stops a watch of blocks only, which never reads a history.
  const controller = new AbortController();
  const blocks = [];
  const reads = historyReads;
  net.watch({}, (event) => blocks.push(event), { intervalMs: 10, signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 40));
  height = 83;
  await until(() => blocks.length === 1);
  controller.abort();
  assert.equal(blocks[0].type, "block");
  assert.equal(historyReads, reads);
  assert.throws(() => net.watch({}, () => {}, { intervalMs: 0 }), sdk.InvalidArgument);

  // Stopping a watch removes its listener from the caller's signal, which may outlive it.
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener: (type, listener) => {
      assert.equal(type, "abort");
      listeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      assert.equal(type, "abort");
      listeners.delete(listener);
    },
  };
  const stops = [1, 2, 3].map(() => net.watch({}, () => {}, { intervalMs: 10, signal }));
  assert.equal(listeners.size, 3);
  for (const stopOne of stops) {
    stopOne();
  }
  assert.equal(listeners.size, 0);
  // Aborting the signal stops the watch and removes the listener too.
  net.watch({}, () => {}, { intervalMs: 10, signal });
  assert.equal(listeners.size, 1);
  const [listener] = listeners;
  listener();
  assert.equal(listeners.size, 0);
  // A signal aborted already gets no listener, and the watch reads nothing. The polls the stopped
  // watches began settle first.
  await new Promise((resolve) => setTimeout(resolve, 40));
  const before = node.requests.length;
  net.watch({}, () => {}, { intervalMs: 10, signal: { ...signal, aborted: true } });
  assert.equal(listeners.size, 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(node.requests.length, before);
});
