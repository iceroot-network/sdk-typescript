// The vote library through WebAssembly: the selection vectors and fixtures of sdk-rust's
// iceroot-vote (checked out next to this repository, as for the build), every mode, the reasons
// and notices, check, validateVote, split, the error codes, the snapshot of a node's validator list
// through the node API client, and a selection signed as a vote.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as sdk from "../../dist/node/index.js";
import * as vote from "../../dist/node/vote.js";
import * as testSdk from "../../build/test/dist/node/index.js";
import { root } from "./helpers.mjs";

const SDK_RUST = join(root, "..", "sdk-rust");
const VOTE_DATA = join(SDK_RUST, "crates", "iceroot-vote", "tests", "data");
const API_FIXTURES = join(SDK_RUST, "crates", "iceroot-sdk-api", "tests", "fixtures", "devnet");
if (!existsSync(join(VOTE_DATA, "select-v1.jsonl"))) {
  throw new Error(`the vote library's vectors are missing: check out sdk-rust next to this repository (${VOTE_DATA})`);
}
const RELAY = "http://127.0.0.1:4003/api";

const readJson = (dir, file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
const synthetic = () => vote.VoteSnapshot.deserialize(readFileSync(join(VOTE_DATA, "synthetic-80.json"), "utf8"));
// The devnet-shaped fixture is relay data in the library's own relay form, which the test build reads.
const devnetShaped = () =>
  vote.VoteSnapshot.deserialize(testSdk.testing.voteSnapshotFromRelay(readFileSync(join(VOTE_DATA, "devnet-relay.json"), "utf8")));
const fixtures = { "synthetic-80": synthetic(), "devnet-relay": devnetShaped() };

function devnetChain() {
  const profile = sdk.profiles.devnet({ relays: [RELAY] });
  return sdk.Chain.load(profile, readFileSync(join(root, "wasm", "examples", "devnet-configuration.json"), "utf8"));
}

/** The reproducible part of a selection, in the vectors' form. */
function output(selection) {
  return {
    drawOrder: [...selection.entries].sort((a, b) => a.step - b.step).map((pick) => pick.validator),
    entries: selection.entries.map((pick) => [pick.validator, pick.basisPoints]),
    pool: selection.pool,
    seed: selection.seed,
    toppedUp: selection.toppedUp,
  };
}

function refusal(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected a refusal");
}

test("the wrapper's constants are the library's", () => {
  const library = testSdk.testing.voteLibrary();
  assert.deepEqual(vote.MODES, library.modes);
  assert.deepEqual({ ...vote.MODE_NAMES }, library.modeNames);
  assert.equal(vote.LIBRARY_VERSION, library.libraryVersion);
  assert.equal(vote.MIN_PICKS, library.minPicks);
  assert.equal(vote.MAX_PICKS, library.maxPicks);
  assert.equal(vote.DEFAULT_PICKS, library.defaultPicks);
  assert.deepEqual({ ...vote.VoteRules.ICEROOT }, library.iceroot);
  assert.deepEqual({ ...vote.VoteRules.SOLAR_COMPATIBLE }, library.solarCompatible);
  // The classic-script and test builds carry the library as a namespace of the root.
  assert.equal(typeof testSdk.vote.select, "function");
});

test("every selection vector of the library is reproduced", () => {
  const lines = readFileSync(join(VOTE_DATA, "select-v1.jsonl"), "utf8").trim().split("\n");
  const meta = JSON.parse(lines[0]);
  assert.equal(meta.library, vote.LIBRARY_VERSION);
  let count = 0;
  for (const line of lines.slice(1)) {
    const record = JSON.parse(line);
    assert.equal(record.op, "vote.select");
    const input = record.input;
    const base = input.rules === "iceroot" ? vote.VoteRules.ICEROOT : vote.VoteRules.SOLAR_COMPATIBLE;
    const rules = input.maxBytes === undefined ? base : { ...base, maxBytes: input.maxBytes };
    const selection = vote.select(fixtures[input.fixture], {
      mode: input.mode,
      account: input.account,
      count: input.count,
      draw: input.draw,
      rules,
    });
    assert.deepEqual(output(selection), record.output, line);
    assert.equal(selection.libraryVersion, "iceroot-vote/1");
    assert.deepEqual(selection.vote, selection.entries.map(({ validator, basisPoints }) => ({ validator, basisPoints })));
    count += 1;
  }
  assert.equal(count, meta.records);
});

test("each mode's pool and weights on the synthetic snapshot are the independently computed ones", () => {
  const expected = readJson(VOTE_DATA, "synthetic-80.expected.json");
  const snapshot = synthetic();
  for (const mode of vote.MODES) {
    const candidates = vote.evaluate(snapshot, mode);
    assert.equal(candidates.length, 80);
    const pool = candidates.filter((c) => c.eligible).map((c) => c.validator).sort();
    assert.deepEqual(pool, [...expected.pools[mode]].sort(), mode);
    for (const candidate of candidates) {
      assert.equal(candidate.eligible, candidate.shortfalls.length === 0);
      assert.equal(typeof candidate.weight, "bigint");
      for (const item of [...candidate.reasons, ...candidate.shortfalls]) {
        assert.equal(typeof item.kind, "string");
        assert.ok(item.text.length > 0);
      }
    }
    if (mode !== "diversity") {
      for (const [name, weight] of Object.entries(expected.weights[mode])) {
        assert.equal(candidates.find((c) => c.validator === name).weight, BigInt(weight), `${mode} ${name}`);
      }
    }
  }
  // Every Diversity pick names the rank band the file gives.
  const bands = new Map();
  for (let draw = 0; draw < 20; draw += 1) {
    const selection = vote.select(snapshot, { mode: "diversity", account: "bands", count: 53, draw, rules: vote.VoteRules.ICEROOT });
    for (const pick of selection.entries) {
      const band = pick.reasons.find((r) => r.kind === "group" && r.dimension === "rank-band");
      bands.set(pick.validator, band.value);
    }
  }
  for (const [name, band] of bands) {
    assert.equal(band, expected.rankBands[name], name);
  }
});

test("a selection explains every pick and says when it was topped up or shortened", () => {
  const selection = vote.select(synthetic(), { mode: "maximum-rewards", account: "holder", rules: vote.VoteRules.ICEROOT });
  assert.equal(selection.entries.length, 20);
  assert.equal(selection.requested, 20);
  assert.equal(typeof selection.snapshotHeight, "bigint");
  assert.equal(selection.snapshotSource, "indexer");
  assert.match(selection.seed, /^[0-9a-f]{64}$/);
  for (const pick of selection.entries) {
    assert.equal(pick.basisPoints, 500);
    assert.ok(["mode", "top-up"].includes(pick.source));
    const drawn = pick.reasons.find((reason) => reason.kind === "drawn");
    assert.equal(typeof drawn.weight, "bigint");
    assert.equal(typeof drawn.totalWeight, "bigint");
    assert.match(drawn.text, /^Drawn at step \d+ from the .+ pool of /);
  }
  const payouts = selection.entries.flatMap((pick) => pick.reasons).find((reason) => reason.kind === "measured-payouts");
  assert.equal(typeof payouts.perUnitWeight, "bigint");
  assert.equal(selection.sizeNotice, null);

  // The devnet-shaped relay snapshot has no payouts, so Maximum Rewards tops up from Diversity.
  const devnet = devnetShaped();
  const toppedUp = vote.select(devnet, { mode: "maximum-rewards", account: "holder", rules: vote.VoteRules.SOLAR_COMPATIBLE });
  assert.equal(toppedUp.snapshotSource, "relay-approximate");
  assert.equal(toppedUp.pool, 0);
  assert.equal(toppedUp.toppedUp, 20);
  assert.ok(toppedUp.entries.every((pick) => pick.source === "top-up"));
  assert.match(toppedUp.topUpNotice, /^No validator meets the Maximum Rewards criteria, so all 20 picks come from Diversity$/);

  // Long names leave fewer picks within the byte limit.
  const small = { ...vote.VoteRules.ICEROOT, maxBytes: 400 };
  const shortened = vote.select(synthetic(), { mode: "diversity", account: "holder", count: 53, rules: small });
  assert.ok(shortened.entries.length < 53);
  assert.equal(shortened.requested, 53);
  assert.match(shortened.sizeNotice, /^Only \d+ of the 53 requested picks fit in a vote of at most 400 bytes$/);
});

test("check reports picks that no longer meet their criteria and never changes the selection", () => {
  const snapshot = synthetic();
  const selection = vote.select(snapshot, { mode: "support-newcomers", account: "holder", rules: vote.VoteRules.ICEROOT });
  assert.ok(vote.check(selection, snapshot).every((finding) => finding.stillMeets && finding.why === "Still meets its criteria"));

  const gone = selection.entries[0].validator;
  const resigned = selection.entries[1].validator;
  const newer = {
    ...snapshot,
    records: snapshot.records
      .filter((record) => record.name !== gone)
      .map((record) => (record.name === resigned ? { ...record, status: "resigned-permanent", seated: false, rank: null } : record)),
  };
  const findings = vote.check(selection, newer);
  assert.equal(findings.length, selection.entries.length);
  assert.deepEqual(findings[0].shortfalls.map((s) => s.kind), ["not-in-snapshot"]);
  assert.equal(findings[0].why, "No longer among the validators a vote can name");
  const second = findings[1];
  assert.equal(second.stillMeets, false);
  assert.ok(second.shortfalls.some((s) => s.kind === "resigned" && s.status === "resigned-permanent"));

  // A selection kept as text checks the same; a pick the holder chose is judged by its registration.
  const kept = vote.Selection.deserialize(vote.Selection.serialize(selection));
  assert.deepEqual(kept, selection);
  const edited = { mode: kept.mode, entries: kept.entries.map((pick, i) => (i === 2 ? { ...pick, source: "holder" } : pick)) };
  const holder = vote.check(edited, newer)[2];
  assert.equal(holder.reasons[0].kind, "chosen-by-holder");
});

test("validateVote and split", () => {
  const entries = vote.split(["genesis_1", "genesis_2", "genesis_3"]);
  assert.deepEqual(entries, [
    { validator: "genesis_1", basisPoints: 3334 },
    { validator: "genesis_2", basisPoints: 3333 },
    { validator: "genesis_3", basisPoints: 3333 },
  ]);
  assert.deepEqual(vote.split([]), []);
  assert.equal(vote.split(Array.from({ length: 53 }, (_, i) => `v${i}`)).filter((e) => e.basisPoints === 189).length, 36);
  assert.deepEqual(vote.validateVote(entries, vote.VoteRules.SOLAR_COMPATIBLE), []);
  const problems = vote.validateVote(entries, vote.VoteRules.ICEROOT, "validator");
  assert.deepEqual(
    problems.map((p) => p.reason),
    ["validator-account", "too-few-entries", "name", "share-too-large", "name", "share-too-large", "name", "share-too-large"],
  );
  assert.deepEqual(problems[1], { reason: "too-few-entries", count: 3, minimum: 20, text: "the vote names 3 validators; a vote names at least 20" });
  assert.deepEqual(vote.validateVote([], vote.VoteRules.ICEROOT, "ordinary"), []);

  const tooMany = refusal(() => vote.split(Array.from({ length: 10_001 }, () => "x")));
  assert.ok(tooMany instanceof sdk.InvalidVote);
  assert.deepEqual(tooMany.details, { reason: "too-many-entries", count: 10_001, maximum: 10_000 });
});

test("refusals carry the library's codes and details", () => {
  const snapshot = synthetic();
  const request = { mode: "diversity", account: "holder", rules: vote.VoteRules.ICEROOT };

  const count = refusal(() => vote.select(snapshot, { ...request, count: 19 }));
  assert.ok(count instanceof vote.InvalidPickCount && count instanceof sdk.IceRootError);
  assert.equal(count.code, "InvalidPickCount");
  assert.deepEqual(count.details, { count: 19, minimum: 20, maximum: 53 });

  const validator = snapshot.records.find((record) => record.status === "active");
  assert.equal(vote.voterOf(snapshot, validator.address), "validator");
  assert.equal(vote.voterOf(snapshot, "holder"), "ordinary");
  assert.ok(refusal(() => vote.select(snapshot, { ...request, account: validator.address })) instanceof vote.ValidatorCannotVote);

  const window = refusal(() => vote.select({ ...snapshot, windowDays: 7 }, request));
  assert.ok(window instanceof vote.InvalidSnapshot);
  assert.equal(window.reason, "window");
  assert.deepEqual(window.details, { reason: "window", days: 7 });
  const twice = refusal(() => vote.VoteSnapshot.validate({ ...snapshot, records: [...snapshot.records, snapshot.records[0]] }));
  assert.equal(twice.reason, "duplicate-name");
  vote.VoteSnapshot.validate(snapshot);

  const few = refusal(() => vote.select({ ...snapshot, records: snapshot.records.slice(0, 10) }, request));
  assert.ok(few instanceof vote.NotEnoughValidators);
  assert.equal(few.details.requested, 20);

  const fits = refusal(() => vote.select(snapshot, { ...request, rules: { ...vote.VoteRules.ICEROOT, maxBytes: 100 } }));
  assert.ok(fits instanceof vote.DoesNotFit);
  assert.deepEqual(Object.keys(fits.details).sort(), ["fits", "maxBytes", "maxEntries", "minimum"]);

  // IceRoot's lowercase names against the devnet's names.
  const breaks = refusal(() => vote.select(devnetShaped(), request));
  assert.ok(breaks instanceof vote.BreaksRules);
  assert.equal(breaks.problems.length, 20);
  assert.ok(breaks.problems.every((problem) => problem.reason === "name"));

  const shape = refusal(() => vote.select({ ...snapshot, height: 5 }, request));
  assert.ok(shape instanceof sdk.InvalidArgument);
  assert.match(shape.message, /^height is missing or not of its documented type$/);
  assert.ok(refusal(() => vote.VoteSnapshot.deserialize("[]")) instanceof sdk.InvalidArgument);
});

test("snapshots round-trip as text", () => {
  const snapshot = synthetic();
  const text = vote.VoteSnapshot.serialize(snapshot);
  assert.deepEqual(JSON.parse(text), readJson(VOTE_DATA, "synthetic-80.json"));
  assert.deepEqual(vote.VoteSnapshot.deserialize(text), snapshot);
});

// ---- a node's validator list -----------------------------------------------------------------

function fixture(name) {
  const entry = readJson(API_FIXTURES, "index.json").find((each) => each.name === name);
  return { status: entry.status, body: readFileSync(join(API_FIXTURES, entry.file), "utf8") };
}

/** A node answering from the recorded devnet, with the lookups `fromNode` makes answered here. */
function recordedNode() {
  const index = readJson(API_FIXTURES, "index.json");
  const requests = [];
  const registrations = readJson(API_FIXTURES, "transactions-validator-registration.json");
  const validators = readJson(API_FIXTURES, "delegates-page.json").data;
  const transport = async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname.slice("/api".length);
    requests.push(`${path}${parsed.search}`);
    let answer;
    if (path === "/transactions" && parsed.searchParams.get("type") === "2") {
      const body = { ...registrations, meta: { ...registrations.meta, pageCount: 1, totalCount: registrations.data.length, next: null } };
      answer = { status: 200, body: JSON.stringify(body) };
    } else if (/^\/delegates\/[^/]+\/blocks$/.test(path)) {
      // The first block a validator forged: height 10 plus its rank.
      const name = decodeURIComponent(path.split("/")[2]);
      const validator = validators.find((each) => each.username === name);
      const page = Number(parsed.searchParams.get("page"));
      const produced = validator.blocks.produced;
      const blocks = readJson(API_FIXTURES, "delegate-blocks.json");
      const block = { ...blocks.data[0], height: page === produced ? 10 + (validator.rank ?? 60) : 1000 };
      const meta = { ...blocks.meta, count: 1, pageCount: produced, totalCount: produced, next: null };
      answer = { status: 200, body: JSON.stringify({ meta, data: [block] }) };
    } else {
      const entry = index.find((each) => each.method === "GET" && each.path.split("?")[0] === path);
      answer = entry === undefined ? { status: 404, body: "{}" } : fixture(entry.name);
    }
    return new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return { transport, requests };
}

test("VoteSnapshot.fromNode reads every validator, the registrations and first forged blocks", async () => {
  const node = recordedNode();
  const net = await sdk.connect(sdk.profiles.devnet({ relays: [RELAY] }), { transport: node.transport, rateLimit: false });
  node.requests.length = 0;
  const snapshot = await vote.VoteSnapshot.fromNode(net);
  assert.equal(snapshot.source, "relay-approximate");
  assert.equal(snapshot.height, 80n);
  assert.equal(snapshot.seats, 53);
  assert.equal(snapshot.blockTimeSeconds, 8);
  // 56 registered validators; the one that has not resigned and whose node was never seen is left
  // out, since a node refuses a vote naming it.
  assert.equal(snapshot.records.length, 55);
  assert.equal(snapshot.records.find((record) => record.name === "tx1n2290"), undefined);
  vote.VoteSnapshot.validate(snapshot);

  const genesis5 = snapshot.records.find((record) => record.name === "genesis_5");
  assert.equal(genesis5.status, "active");
  assert.equal(genesis5.seated, true);
  assert.equal(genesis5.rank, 1);
  assert.equal(typeof genesis5.voteWeight, "bigint");
  assert.equal(genesis5.penalties, null);
  // Seated days from the first forged block (height 11) to the node's height 80: under a day.
  assert.equal(genesis5.seatedDaysInWindow, 0);
  const registered = snapshot.records.filter((record) => record.registeredHeight !== null);
  assert.ok(registered.length > 0);

  const blockLookups = node.requests.filter((request) => /^\/delegates\/[^/]+\/blocks/.test(request));
  const forged = snapshot.records.filter((record) => record.production !== null && record.production.forged > 0);
  assert.equal(blockLookups.length, forged.length);
  assert.ok(node.requests.some((request) => request.startsWith("/delegates?page=1&limit=100")));

  // Without the lookups, only the validator list is read.
  node.requests.length = 0;
  const plain = await vote.VoteSnapshot.fromNode(net, { firstForged: false, registrations: false });
  assert.ok(plain.records.every((record) => record.registeredHeight === null));
  assert.ok(node.requests.every((request) => !request.includes("/blocks") && !request.startsWith("/transactions")));

  // The devnet's own rules, and a valid vote in every mode; the modes the devnet cannot serve top up.
  const rules = vote.VoteRules.of(net);
  assert.deepEqual({ ...rules }, { ...vote.VoteRules.SOLAR_COMPATIBLE });
  for (const mode of vote.MODES) {
    const selection = vote.select(snapshot, { mode, account: "dZ1W1GsDCSyhR148oMhuHy3PkhnnSGCqVn", rules });
    assert.deepEqual(vote.validateVote(selection.vote, rules), [], mode);
    if (mode !== "diversity") {
      assert.ok(selection.toppedUp > 0, mode);
      assert.notEqual(selection.topUpNotice, null);
    }
  }
});

test("VoteSnapshot.fromValidators and a selection signed as a vote", () => {
  const chain = devnetChain();
  assert.deepEqual({ ...vote.VoteRules.of(chain, 2) }, { ...vote.VoteRules.SOLAR_COMPATIBLE });
  const answer = JSON.parse(fixture("delegates-page").body).data;
  // The node API client's records for the list, as net.validators.list gives them.
  const validators = answer.map((each) => ({
    name: each.username,
    address: each.address,
    publicKey: each.publicKey,
    ...(each.rank === undefined ? {} : { rank: each.rank }),
    status: each.isResigned ? "resigned-permanent" : each.rank <= 53 ? "active" : "standby",
    voteWeight: BigInt(each.votesReceived.votes),
    voteShareBasisPoints: 0,
    voters: BigInt(each.votesReceived.voters),
    production: { produced: BigInt(each.blocks.produced), missed: 0n },
    earnings: { rewards: 0n, fees: 0n, burnedFees: 0n, donations: 0n, total: 0n },
    ...(each.version === undefined ? {} : { version: each.version }),
  }));
  const snapshot = vote.VoteSnapshot.fromValidators(chain, 80, validators, { genesis_5: { registeredHeight: 1n, firstForgedHeight: 2n } });
  // Every validator but the one without a node version that has not resigned.
  const votable = validators.filter((each) => each.status.startsWith("resigned") || each.version !== undefined);
  assert.equal(votable.length, validators.length - 1);
  assert.deepEqual(
    snapshot.records.map((record) => record.name).sort(),
    votable.map((each) => each.name).sort(),
  );
  // Without versions, only the resigned validators remain.
  const unseen = vote.VoteSnapshot.fromValidators(chain, 80, validators.map(({ version: _, ...rest }) => rest));
  assert.ok(unseen.records.length > 0 && unseen.records.every((record) => record.status.startsWith("resigned")));
  const genesis5 = snapshot.records.find((record) => record.name === "genesis_5");
  assert.equal(genesis5.registeredHeight, 1n);

  const account = sdk.Keys.fromLegacyPassphrase("vote library holder", chain.profile);
  const selection = vote.select(snapshot, { mode: "diversity", account: account.address, rules: vote.VoteRules.of(chain, 81) });
  const draft = sdk.Draft.build(
    chain,
    { operation: { kind: "vote", entries: selection.vote }, fee: 100_000_000n },
    { sender: account, nonce: 1n, height: 81 },
  );
  const signed = draft.sign(account);
  assert.match(signed.id, /^[0-9a-f]{64}$/);
  account.release();
});
