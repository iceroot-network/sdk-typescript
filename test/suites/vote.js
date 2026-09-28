// The vote library: the selection vectors and fixtures of sdk-rust's iceroot-vote, every mode, the
// reasons and notices, check, validateVote, split, the error codes, the snapshot of a node's
// validator list through the node API client, and a selection signed as a vote.

const RELAY = "http://127.0.0.1:4003/api";
const VOTE_DATA = "rs/crates/iceroot-vote/tests/data";
const API_FIXTURES = "rs/crates/iceroot-sdk-api/tests/fixtures/devnet";

export default function suite(test, env) {
  const { sdk, vote, testSdk, assert } = env;
  const readJson = async (path) => JSON.parse(await env.read(path));
  const synthetic = async () => vote.VoteSnapshot.deserialize(await env.read(`${VOTE_DATA}/synthetic-80.json`));
  // The devnet-shaped fixture is relay data in the library's own relay form, which the test build reads.
  const devnetShaped = async () =>
    vote.VoteSnapshot.deserialize(await testSdk.testing.voteSnapshotFromRelay(await env.read(`${VOTE_DATA}/devnet-relay.json`)));

  async function devnetChain() {
    const profile = sdk.profiles.devnet({ relays: [RELAY] });
    return sdk.Chain.load(profile, await env.read("ts/wasm/examples/devnet-configuration.json"));
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

  async function refusal(fn) {
    try {
      await fn();
    } catch (error) {
      return error;
    }
    assert.fail("expected a refusal");
  }

  test("the wrapper's constants are the library's", async () => {
    const library = await testSdk.testing.voteLibrary();
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

  test("every selection vector of the library is reproduced", async () => {
    const fixtures = { "synthetic-80": await synthetic(), "devnet-relay": await devnetShaped() };
    const lines = (await env.read(`${VOTE_DATA}/select-v1.jsonl`)).trim().split("\n");
    const meta = JSON.parse(lines[0]);
    assert.equal(meta.library, vote.LIBRARY_VERSION);
    let count = 0;
    for (const line of lines.slice(1)) {
      const record = JSON.parse(line);
      assert.equal(record.op, "vote.select");
      const input = record.input;
      const base = input.rules === "iceroot" ? vote.VoteRules.ICEROOT : vote.VoteRules.SOLAR_COMPATIBLE;
      const rules = input.maxBytes === undefined ? base : { ...base, maxBytes: input.maxBytes };
      const selection = await vote.select(fixtures[input.fixture], {
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

  test("each mode's pool and weights on the synthetic snapshot are the independently computed ones", async () => {
    const expected = await readJson(`${VOTE_DATA}/synthetic-80.expected.json`);
    const snapshot = await synthetic();
    for (const mode of vote.MODES) {
      const candidates = await vote.evaluate(snapshot, mode);
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
      const selection = await vote.select(snapshot, { mode: "diversity", account: "bands", count: 53, draw, rules: vote.VoteRules.ICEROOT });
      for (const pick of selection.entries) {
        const band = pick.reasons.find((r) => r.kind === "group" && r.dimension === "rank-band");
        bands.set(pick.validator, band.value);
      }
    }
    for (const [name, band] of bands) {
      assert.equal(band, expected.rankBands[name], name);
    }
  });

  test("a selection explains every pick and says when it was topped up or shortened", async () => {
    const selection = await vote.select(await synthetic(), { mode: "maximum-rewards", account: "holder", rules: vote.VoteRules.ICEROOT });
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
    const devnet = await devnetShaped();
    const toppedUp = await vote.select(devnet, { mode: "maximum-rewards", account: "holder", rules: vote.VoteRules.SOLAR_COMPATIBLE });
    assert.equal(toppedUp.snapshotSource, "relay-approximate");
    assert.equal(toppedUp.pool, 0);
    assert.equal(toppedUp.toppedUp, 20);
    assert.ok(toppedUp.entries.every((pick) => pick.source === "top-up"));
    assert.match(toppedUp.topUpNotice, /^No validator meets the Maximum Rewards criteria, so all 20 picks come from Diversity$/);

    // Long names leave fewer picks within the byte limit.
    const small = { ...vote.VoteRules.ICEROOT, maxBytes: 400 };
    const shortened = await vote.select(await synthetic(), { mode: "diversity", account: "holder", count: 53, rules: small });
    assert.ok(shortened.entries.length < 53);
    assert.equal(shortened.requested, 53);
    assert.match(shortened.sizeNotice, /^Only \d+ of the 53 requested picks fit in a vote of at most 400 bytes$/);
  });

  test("check reports picks that no longer meet their criteria and never changes the selection", async () => {
    const snapshot = await synthetic();
    const selection = await vote.select(snapshot, { mode: "support-newcomers", account: "holder", rules: vote.VoteRules.ICEROOT });
    assert.ok((await vote.check(selection, snapshot)).every((finding) => finding.stillMeets && finding.why === "Still meets its criteria"));

    const gone = selection.entries[0].validator;
    const resigned = selection.entries[1].validator;
    const newer = {
      ...snapshot,
      records: snapshot.records
        .filter((record) => record.name !== gone)
        .map((record) => (record.name === resigned ? { ...record, status: "resigned-permanent", seated: false, rank: null } : record)),
    };
    const findings = await vote.check(selection, newer);
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
    const holder = (await vote.check(edited, newer))[2];
    assert.equal(holder.reasons[0].kind, "chosen-by-holder");
  });

  test("validateVote and split", async () => {
    const entries = await vote.split(["genesis_1", "genesis_2", "genesis_3"]);
    assert.deepEqual(entries, [
      { validator: "genesis_1", basisPoints: 3334 },
      { validator: "genesis_2", basisPoints: 3333 },
      { validator: "genesis_3", basisPoints: 3333 },
    ]);
    assert.deepEqual(await vote.split([]), []);
    assert.equal((await vote.split(Array.from({ length: 53 }, (_, i) => `v${i}`))).filter((e) => e.basisPoints === 189).length, 36);
    assert.deepEqual(await vote.validateVote(entries, vote.VoteRules.SOLAR_COMPATIBLE), []);
    const problems = await vote.validateVote(entries, vote.VoteRules.ICEROOT, "validator");
    assert.deepEqual(
      problems.map((p) => p.reason),
      ["validator-account", "too-few-entries", "name", "share-too-large", "name", "share-too-large", "name", "share-too-large"],
    );
    assert.deepEqual(problems[1], { reason: "too-few-entries", count: 3, minimum: 20, text: "the vote names 3 validators; a vote names at least 20" });
    assert.deepEqual(await vote.validateVote([], vote.VoteRules.ICEROOT, "ordinary"), []);

    const tooMany = await refusal(() => vote.split(Array.from({ length: 10_001 }, () => "x")));
    assert.ok(tooMany instanceof sdk.InvalidVote);
    assert.deepEqual(tooMany.details, { reason: "too-many-entries", count: 10_001, maximum: 10_000 });
  });

  test("refusals carry the library's codes and details", async () => {
    const snapshot = await synthetic();
    const request = { mode: "diversity", account: "holder", rules: vote.VoteRules.ICEROOT };

    const count = await refusal(() => vote.select(snapshot, { ...request, count: 19 }));
    assert.ok(count instanceof vote.InvalidPickCount && count instanceof sdk.IceRootError);
    assert.equal(count.code, "InvalidPickCount");
    assert.deepEqual(count.details, { count: 19, minimum: 20, maximum: 53 });

    const validator = snapshot.records.find((record) => record.status === "active");
    assert.equal(await vote.voterOf(snapshot, validator.address), "validator");
    assert.equal(await vote.voterOf(snapshot, "holder"), "ordinary");
    assert.ok((await refusal(() => vote.select(snapshot, { ...request, account: validator.address }))) instanceof vote.ValidatorCannotVote);

    const window = await refusal(() => vote.select({ ...snapshot, windowDays: 7 }, request));
    assert.ok(window instanceof vote.InvalidSnapshot);
    assert.equal(window.reason, "window");
    assert.deepEqual(window.details, { reason: "window", days: 7 });
    const twice = await refusal(() => vote.VoteSnapshot.validate({ ...snapshot, records: [...snapshot.records, snapshot.records[0]] }));
    assert.equal(twice.reason, "duplicate-name");
    await vote.VoteSnapshot.validate(snapshot);

    const few = await refusal(() => vote.select({ ...snapshot, records: snapshot.records.slice(0, 10) }, request));
    assert.ok(few instanceof vote.NotEnoughValidators);
    assert.equal(few.details.requested, 20);

    const fits = await refusal(() => vote.select(snapshot, { ...request, rules: { ...vote.VoteRules.ICEROOT, maxBytes: 100 } }));
    assert.ok(fits instanceof vote.DoesNotFit);
    assert.deepEqual(Object.keys(fits.details).sort(), ["fits", "maxBytes", "maxEntries", "minimum"]);

    // IceRoot's lowercase names against the devnet's names.
    const breaks = await refusal(async () => vote.select(await devnetShaped(), request));
    assert.ok(breaks instanceof vote.BreaksRules);
    assert.equal(breaks.problems.length, 20);
    assert.ok(breaks.problems.every((problem) => problem.reason === "name"));

    const shape = await refusal(() => vote.select({ ...snapshot, height: 5 }, request));
    assert.ok(shape instanceof sdk.InvalidArgument);
    assert.match(shape.message, /^height is missing or not of its documented type$/);
    assert.ok((await refusal(() => vote.VoteSnapshot.deserialize("[]"))) instanceof sdk.InvalidArgument);
  });

  test("snapshots round-trip as text", async () => {
    const snapshot = await synthetic();
    const text = vote.VoteSnapshot.serialize(snapshot);
    assert.deepEqual(JSON.parse(text), await readJson(`${VOTE_DATA}/synthetic-80.json`));
    assert.deepEqual(vote.VoteSnapshot.deserialize(text), snapshot);
  });

  // ---- a node's validator list ---------------------------------------------------------------

  test("VoteSnapshot.fromNode reads every validator, the registrations and first forged blocks", async () => {
    // The lookups fromNode makes are answered by the recorded node's vote behaviors.
    const node = await env.node({
      "GET /transactions": { behavior: "vote-registrations" },
      "GET /delegates/*/blocks": { behavior: "vote-first-forged" },
    });
    const net = await sdk.connect(sdk.profiles.devnet({ relays: [node.relay] }), { ...node.options, rateLimit: false });
    const since = (await node.requests()).length;
    const paths = async (from) => (await node.requests()).slice(from).map((request) => `${request.path}${request.query === "" ? "" : `?${request.query}`}`);
    const snapshot = await vote.VoteSnapshot.fromNode(net);
    assert.equal(snapshot.source, "relay-approximate");
    assert.equal(snapshot.height, 80n);
    assert.equal(snapshot.seats, 53);
    assert.equal(snapshot.blockTimeSeconds, 8);
    // 56 registered validators; the one that has not resigned and whose node was never seen is left
    // out, since a node refuses a vote naming it.
    assert.equal(snapshot.records.length, 55);
    assert.equal(snapshot.records.find((record) => record.name === "tx1n2290"), undefined);
    await vote.VoteSnapshot.validate(snapshot);

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

    const read = await paths(since);
    const blockLookups = read.filter((request) => /^\/delegates\/[^/]+\/blocks/.test(request));
    const forged = snapshot.records.filter((record) => record.production !== null && record.production.forged > 0);
    assert.equal(blockLookups.length, forged.length);
    assert.ok(read.some((request) => request.startsWith("/delegates?page=1&limit=100")));

    // Without the lookups, only the validator list is read.
    const before = (await node.requests()).length;
    const plain = await vote.VoteSnapshot.fromNode(net, { firstForged: false, registrations: false });
    assert.ok(plain.records.every((record) => record.registeredHeight === null));
    assert.ok((await paths(before)).every((request) => !request.includes("/blocks") && !request.startsWith("/transactions")));

    // The devnet's own rules, and a valid vote in every mode; the modes the devnet cannot serve top up.
    const rules = await vote.VoteRules.of(net);
    assert.deepEqual({ ...rules }, { ...vote.VoteRules.SOLAR_COMPATIBLE });
    for (const mode of vote.MODES) {
      const selection = await vote.select(snapshot, { mode, account: "dZ1W1GsDCSyhR148oMhuHy3PkhnnSGCqVn", rules });
      assert.deepEqual(await vote.validateVote(selection.vote, rules), [], mode);
      if (mode !== "diversity") {
        assert.ok(selection.toppedUp > 0, mode);
        assert.notEqual(selection.topUpNotice, null);
      }
    }
  });

  const answer = (status, body) => ({ status, headers: {}, body: typeof body === "string" ? body : JSON.stringify(body) });

  test("VoteSnapshot.fromNode keeps a relay's names out of every object's prototype", async () => {
    const validators = await readJson(`${API_FIXTURES}/delegates-page.json`);
    validators.data[0].username = "constructor";
    validators.data[2].username = "__proto__";
    const registrations = await readJson(`${API_FIXTURES}/transactions-validator-registration.json`);
    const template = registrations.data[0];
    const registration = (name, height, index) => ({
      ...template,
      id: template.id.slice(0, 62) + String(index).padStart(2, "0"),
      blockHeight: height,
      asset: { delegate: { username: name } },
    });
    registrations.data = [registration("__proto__", 10, 1), registration("constructor", 11, 2), registration("genesis_17", 12, 3)];
    registrations.meta = { ...registrations.meta, count: 3, pageCount: 1, totalCount: 3, next: null };
    const blocks = await readJson(`${API_FIXTURES}/delegate-blocks.json`);
    const firstBlock = answer(200, { meta: { ...blocks.meta, count: 1, pageCount: 2, totalCount: 2, next: null }, data: [{ ...blocks.data[0], height: 15 }] });
    const node = await env.node({
      "GET /delegates": answer(200, validators),
      "GET /transactions": answer(200, registrations),
      "GET /delegates/constructor/blocks": firstBlock,
      "GET /delegates/__proto__/blocks": firstBlock,
      "GET /delegates/*/blocks": { behavior: "vote-first-forged" },
    });
    const net = await sdk.connect(sdk.profiles.devnet({ relays: [node.relay] }), { ...node.options, rateLimit: false });
    try {
      const snapshot = await vote.VoteSnapshot.fromNode(net);
      assert.equal({}.registeredHeight, undefined);
      assert.equal({}.firstForgedHeight, undefined);
      assert.equal(Object.registeredHeight, undefined);
      assert.equal(Object.firstForgedHeight, undefined);
      const named = (name) => snapshot.records.find((record) => record.name === name);
      assert.equal(named("constructor").registeredHeight, 11n);
      assert.notEqual(named("constructor").seatedDaysInWindow, null);
      assert.equal(named("genesis_17").registeredHeight, 12n);
    } finally {
      for (const target of [Object.prototype, Object]) {
        delete target.registeredHeight;
        delete target.firstForgedHeight;
      }
    }
  });

  test("VoteSnapshot.fromNode refuses a listing without end or a page longer than asked for, and keeps one record per name", async () => {
    const page = await readJson(`${API_FIXTURES}/delegates-page.json`);
    const template = page.data[0];
    const profile = sdk.profiles.devnet({ relays: [RELAY] });
    const validator = (index, key) => ({
      ...template,
      username: `v${index}`,
      rank: index + 1,
      blocks: { produced: 0 },
      ...(key === undefined ? {} : { address: key.address, publicKey: key.publicKey }),
    });
    const listing = (items, next) =>
      answer(200, {
        meta: { ...page.meta, count: items.length, pageCount: 100, totalCount: 10_000, next: next ? "/delegates?page=2&limit=100" : null },
        data: items,
      });
    const snapshotOf = async (routes) => {
      const node = await env.node(routes);
      const net = await sdk.connect(sdk.profiles.devnet({ relays: [node.relay] }), { ...node.options, rateLimit: false });
      return vote.VoteSnapshot.fromNode(net, { registrations: false, firstForged: false });
    };
    const refused = async (routes, reason) => {
      const error = await refusal(() => snapshotOf(routes));
      assert.ok(error instanceof sdk.BadResponse, String(error));
      assert.equal(error.details.reason, reason);
    };

    // More than 2,000 validators, a new hundred on every page.
    const pages = [];
    for (let number = 0; number < 21; number += 1) {
      pages.push(listing(Array.from({ length: 100 }, (_, i) => validator(number * 100 + i)), true));
    }
    await refused({ "GET /delegates": { sequence: pages } }, "too-many");
    // A page with more items than asked for.
    await refused({ "GET /delegates": listing(Array.from({ length: 101 }, (_, i) => validator(i)), false) }, "page-too-long");

    // A validator that moved to the next page between two reads is kept once.
    const keys = [];
    for (let i = 0; i < 150; i += 1) {
      const account = await sdk.Keys.fromLegacyPassphrase(`vote page ${i}`, profile);
      keys.push({ address: account.address, publicKey: account.publicKey });
      await account.release();
    }
    const shifted = await snapshotOf({
      "GET /delegates": {
        sequence: [
          listing(keys.slice(0, 100).map((key, i) => validator(i, key)), true),
          listing(keys.slice(99).map((key, i) => validator(i + 99, key)), false),
        ],
      },
    });
    assert.equal(shifted.records.length, 150);
    await vote.VoteSnapshot.validate(shifted);
  });

  test("production counts a JavaScript number cannot hold exactly are refused", async () => {
    const text = await env.read(`${API_FIXTURES}/delegates-page.json`);
    assert.ok(text.includes('"produced":2,'));
    const node = await env.node({ "GET /delegates": answer(200, text.replace('"produced":2,', '"produced":9007199254740993,')) });
    const net = await sdk.connect(sdk.profiles.devnet({ relays: [node.relay] }), { ...node.options, rateLimit: false });
    const error = await refusal(() => vote.VoteSnapshot.fromNode(net, { registrations: false, firstForged: false }));
    assert.ok(error instanceof vote.InvalidSnapshot, String(error));
    assert.equal(error.reason, "inconsistent");
    assert.equal(error.details.field, "production");
  });

  test("VoteSnapshot.fromValidators and a selection signed as a vote", async () => {
    const chain = await devnetChain();
    assert.deepEqual({ ...(await vote.VoteRules.of(chain, 2)) }, { ...vote.VoteRules.SOLAR_COMPATIBLE });
    const answer = (await readJson(`${API_FIXTURES}/delegates-page.json`)).data;
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
    const snapshot = await vote.VoteSnapshot.fromValidators(chain, 80, validators, { genesis_5: { registeredHeight: 1n, firstForgedHeight: 2n } });
    // Every validator but the one without a node version that has not resigned.
    const votable = validators.filter((each) => each.status.startsWith("resigned") || each.version !== undefined);
    assert.equal(votable.length, validators.length - 1);
    assert.deepEqual(
      snapshot.records.map((record) => record.name).sort(),
      votable.map((each) => each.name).sort(),
    );
    // Without versions, only the resigned validators remain.
    const unseen = await vote.VoteSnapshot.fromValidators(chain, 80, validators.map(({ version: _, ...rest }) => rest));
    assert.ok(unseen.records.length > 0 && unseen.records.every((record) => record.status.startsWith("resigned")));
    const genesis5 = snapshot.records.find((record) => record.name === "genesis_5");
    assert.equal(genesis5.registeredHeight, 1n);

    const account = await sdk.Keys.fromLegacyPassphrase("vote library holder", chain.profile);
    const selection = await vote.select(snapshot, { mode: "diversity", account: account.address, rules: await vote.VoteRules.of(chain, 81) });
    const draft = await sdk.Draft.build(
      chain,
      { operation: { kind: "vote", entries: selection.vote }, fee: 100_000_000n },
      { sender: account, nonce: 1n, height: 81 },
    );
    const signed = await draft.sign(account);
    assert.match(signed.id, /^[0-9a-f]{64}$/);
    await account.release();
  });
}
