// Drafts and signed transactions against the native Rust vectors: a transfer and a vote built and
// signed reproduce the native transactions byte for byte (test build), the published build signs
// with fresh randomness over the same unsigned bytes, and a draft built in one context is signed in
// another that has no network (a second WebAssembly instance; with the Tauri plugin, the plugin
// itself, which reads the draft again from its bytes).

const RELAY = "http://127.0.0.1:4003/api";

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const bytesOf = (text) => Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

export default function suite(test, env) {
  const { sdk, testSdk, otherSdk, assert } = env;
  let vectors;
  const data = () => vectors.transactions;
  const byName = (fragment) => {
    const found = data().cases.find((txCase) => txCase.name.startsWith(fragment));
    assert.ok(found, fragment);
    return found;
  };
  const load = async () => {
    vectors ??= JSON.parse(await env.read("ts/test/vectors/wasm-native.json"));
    return {
      TRANSFER: byName("transfer to two recipients"),
      AT_FLOOR: byName("transfer at the fee floor"),
      VOTE: byName("vote for three validators"),
      SECOND: byName("transfer signed with a second key"),
    };
  };

  function account(module, signer, source) {
    return signer.legacyPassphrase === undefined
      ? module.Keys.fromPhrase(signer.phrase, source, { account: signer.account, index: signer.index })
      : module.Keys.fromLegacyPassphrase(signer.legacyPassphrase, source);
  }

  function transfer(txCase) {
    return {
      operation: {
        kind: "transfer",
        to: txCase.request.operation.to.map(({ address, amount }) => ({ address, amount: BigInt(amount) })),
      },
      ...(txCase.request.memo === null ? {} : { memo: txCase.request.memo }),
      fee: txCase.request.fee.kind === "minimum" ? "minimum" : BigInt(txCase.request.fee.amount),
    };
  }

  function vote(txCase) {
    return { operation: txCase.request.operation, fee: BigInt(txCase.request.fee.amount) };
  }

  async function build(module, txCase, request) {
    const chain = await module.Chain.load(module.profiles.devnet({ relays: [RELAY] }), data().configuration);
    const sender = await account(module, txCase.signer, chain);
    const facts = {
      sender,
      nonce: BigInt(txCase.facts.nonce),
      height: txCase.facts.height,
      ...(txCase.facts.secondKey === null ? {} : { secondKey: txCase.facts.secondKey }),
    };
    return { chain, sender, draft: await module.Draft.build(chain, request, facts) };
  }

  test("a transfer and a vote built and signed are the native transactions", async () => {
    const { TRANSFER, AT_FLOOR, VOTE } = await load();
    for (const [txCase, request] of [
      [TRANSFER, transfer(TRANSFER)],
      [AT_FLOOR, transfer(AT_FLOOR)],
      [VOTE, vote(VOTE)],
    ]) {
      const { chain, sender, draft } = await build(testSdk, txCase, request);
      assert.equal(chain.nethash, data().nethash);
      assert.equal(hex(draft.unsignedBytes), txCase.unsigned, txCase.name);
      const signed = await testSdk.testing.signDraftWithAux(draft, sender, bytesOf(txCase.aux));
      assert.equal(signed.id, txCase.id, txCase.name);
      assert.equal(hex(signed.bytes), txCase.bytes, txCase.name);
      assert.deepEqual(signed.json, txCase.json, txCase.name);
      assert.equal(signed.verified, true);
      assert.equal(await testSdk.testing.sha256(draft.serialize()), txCase.draftSha256);
      assert.equal(await testSdk.testing.sha256(signed.serialize()), txCase.signedSha256);
      await sender.release();
    }
  });

  test("the review summary is computed from the transaction's own fields", async () => {
    const { TRANSFER, VOTE } = await load();
    const { chain, sender, draft } = await build(sdk, TRANSFER, transfer(TRANSFER));
    const summary = draft.summary;
    assert.equal(summary.kind, "transfer");
    assert.equal(summary.from, sender.address);
    assert.equal(summary.nonce, 1n);
    assert.equal(summary.fee.amount, 1_000_000n);
    assert.equal(summary.fee.source, "explicit");
    assert.equal(summary.fee.floor, BigInt(TRANSFER.summary.feeFloor));
    assert.equal(summary.amount, 150_000_001n);
    assert.equal(summary.total, 151_000_001n);
    assert.equal(summary.memo, TRANSFER.request.memo);
    assert.equal(summary.size, TRANSFER.summary.size);
    assert.deepEqual(summary.lines, [
      `Send 1.5 ${chain.token.symbol} to ${TRANSFER.request.operation.to[0].address}`,
      `Send 0.00000001 ${chain.token.symbol} to ${TRANSFER.request.operation.to[1].address}`,
      `Memo: ${TRANSFER.request.memo}`,
      `Fee 0.01 ${chain.token.symbol}`,
    ]);
    assert.ok(Object.isFrozen(summary));

    // The vote's entries are signed in the network's canonical order, whatever order they came in.
    const voteDraft = (await build(sdk, VOTE, vote(VOTE))).draft;
    assert.deepEqual(
      voteDraft.summary.operation.entries.map((entry) => entry.validator),
      VOTE.summary.operation.entries.map((entry) => entry.validator),
    );
    assert.deepEqual(voteDraft.summary.lines.slice(0, 3), ["Vote 50% for genesis_1", "Vote 25% for genesis_10", "Vote 25% for genesis_2"]);
    await sender.release();
  });

  test("review lines escape control and bidirectional characters", async () => {
    const { TRANSFER } = await load();
    const memo = "refund\nFee 0 ROOT ‮exe.pdf⁦x⁩ \\ \u0000\u0085  冰根 עברית";
    const request = { ...transfer(TRANSFER), memo };
    const { chain, sender, draft } = await build(sdk, TRANSFER, request);
    // The summary keeps the memo as signed; only the readable lines escape it.
    assert.equal(draft.summary.memo, memo);
    const lines = draft.summary.lines;
    assert.equal(lines.length, 4);
    assert.equal(
      lines[2],
      "Memo: refund\\u000AFee 0 ROOT \\u202Eexe.pdf\\u2066x\\u2069 \\\\ \\u0000\\u0085\\u2028 冰根 עברית",
    );
    assert.equal(lines[3], `Fee 0.01 ${chain.token.symbol}`);
    for (const line of lines) {
      assert.doesNotMatch(line, /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u);
    }
    await sender.release();
  });

  test("review lines escape spaces other than the ASCII space, and invisible characters", async () => {
    const { TRANSFER } = await load();
    const memo = "a\u00a0b\u3000c\u2003d\u200be\u2060f\u00adg\ufeffh i";
    const { sender, draft } = await build(sdk, TRANSFER, { ...transfer(TRANSFER), memo });
    assert.equal(draft.summary.memo, memo);
    assert.equal(
      draft.summary.lines[2],
      "Memo: a\\u00A0b\\u3000c\\u2003d\\u200Be\\u2060f\\u00ADg\\uFEFFh i",
    );
    await sender.release();
  });

  test("review lines escape runs of ASCII spaces, so a padded memo cannot pass for a line of its own", async () => {
    const { TRANSFER } = await load();
    const recipient = TRANSFER.request.operation.to[0].address;
    const memo = `thanks${" ".repeat(180)}Send 1000 dRT to ${recipient}`;
    const { sender, draft } = await build(sdk, TRANSFER, { ...transfer(TRANSFER), memo });
    assert.equal(draft.summary.memo, memo);
    const line = draft.summary.lines.find((text) => text.startsWith("Memo:"));
    assert.equal(line, `Memo: thanks${"\\u0020".repeat(180)}Send 1000 dRT to ${recipient}`);
    for (const text of draft.summary.lines) {
      assert.ok(!text.includes("  "), text);
    }
    // One space between words stays a space.
    const words = await build(sdk, TRANSFER, { ...transfer(TRANSFER), memo: "a b  c" });
    assert.equal(words.draft.summary.lines.find((text) => text.startsWith("Memo:")), "Memo: a b\\u0020\\u0020c");
    await words.sender.release();
    await sender.release();
  });

  test("a token symbol is a short word, so it cannot write into the review lines", async () => {
    const { TRANSFER } = await load();
    const devnet = sdk.profiles.devnet({ relays: [RELAY] });
    const withLabel = (key, text) => {
      const configuration = structuredClone(data().configuration);
      configuration.network.client[key] = text;
      return configuration;
    };
    const recipient = TRANSFER.request.operation.to[0].address;
    for (const symbol of ["", `dRT to ${recipient}${" ".repeat(400)}`, "d\u00a0RT", "dRT\u200b", "d.RT", "ABCDEFGHIJK"]) {
      await assert.rejects(async () => sdk.Chain.load(devnet, withLabel("symbol", symbol)), sdk.BadResponse, JSON.stringify(symbol));
    }
    for (const name of ["", "two  spaces", " dROOT", "dROOT\n", "d".repeat(33), "dROOT to someone\u2003"]) {
      await assert.rejects(async () => sdk.Chain.load(devnet, withLabel("token", name)), sdk.BadResponse, JSON.stringify(name));
    }
    assert.equal((await sdk.Chain.load(devnet, withLabel("symbol", "ROOT"))).token.symbol, "ROOT");
    assert.equal((await sdk.Chain.load(devnet, withLabel("token", "IceRoot devnet v2.1-a"))).token.name, "IceRoot devnet v2.1-a");

    // A draft whose travelling configuration names such a symbol is refused where it is signed.
    const { chain, sender, draft } = await build(sdk, TRANSFER, transfer(TRANSFER));
    const text = new TextDecoder().decode(draft.serialize());
    assert.ok(text.includes('"symbol":"dRT"'));
    const tampered = text.replace('"symbol":"dRT"', `"symbol":"dRT to ${recipient}${" ".repeat(400)}"`);
    await assert.rejects(
      async () => sdk.Draft.deserialize(new TextEncoder().encode(tampered), chain.profile),
      sdk.BadResponse,
    );
    await sender.release();
  });

  test("the published build signs the native unsigned bytes with fresh randomness", async () => {
    const { TRANSFER, VOTE } = await load();
    for (const [txCase, request] of [
      [TRANSFER, transfer(TRANSFER)],
      [VOTE, vote(VOTE)],
    ]) {
      const { sender, draft } = await build(sdk, txCase, request);
      const one = await draft.sign(sender);
      const two = await draft.sign(sender);
      for (const signed of [one, two]) {
        assert.equal(signed.verified, true);
        assert.equal(hex(signed.bytes).slice(0, txCase.unsigned.length), txCase.unsigned);
        assert.equal(signed.summary.from, txCase.summary.from);
        assert.equal(signed.summary.nonce, BigInt(txCase.summary.nonce));
      }
      assert.notEqual(one.id, two.id);
      assert.equal("testing" in sdk, false);
      await sender.release();
    }
  });

  test("a draft built in one context is signed in another with no network", async () => {
    const { SECOND } = await load();
    const { chain, draft } = await build(sdk, SECOND, transfer(SECOND));
    const bytes = draft.serialize();

    // The signing context knows only the pinned profile, passed as a plain object.
    const profile = structuredClone(chain.profile);
    const received = await otherSdk.Draft.deserialize(bytes, profile);
    assert.deepEqual(received.summary.lines, draft.summary.lines);
    assert.equal(received.summary.secondSignature, true);
    const key = await account(otherSdk, SECOND.signer, profile);
    const second = await account(otherSdk, SECOND.secondSigner, profile);
    await assert.rejects(async () => received.sign(key), otherSdk.WrongKey);
    const signed = await received.sign(key, { secondKey: second });
    assert.equal(await signed.verifySecondSignature(second.publicKey), true);

    // Back where the network is.
    const back = await sdk.SignedTransaction.deserialize(signed.serialize(), chain.profile);
    assert.equal(back.id, signed.id);
    assert.equal(back.verified, true);
    assert.equal(await back.verifySecondSignature(second.publicKey), true);
    assert.equal(hex(back.bytes).slice(0, SECOND.unsigned.length), SECOND.unsigned);

    // Another network's profile refuses the draft.
    const other = sdk.profiles.devnet({ relays: [RELAY], nethash: "00".repeat(32) });
    await assert.rejects(async () => sdk.Draft.deserialize(bytes, other), sdk.NetworkMismatch);
    await assert.rejects(async () => sdk.Draft.deserialize(bytes, sdk.profiles.devnet({ relays: [RELAY] })), sdk.NetworkMismatch);
    await assert.rejects(async () => sdk.Draft.deserialize(bytes.slice(0, 20), chain.profile), sdk.IceRootError);
    await key.release();
    await second.release();
  });

  test("a message signature never signs or passes for a transaction", async () => {
    const { TRANSFER } = await load();
    const { sender, draft } = await build(sdk, TRANSFER, transfer(TRANSFER));
    const unsigned = draft.unsignedBytes;
    assert.equal(unsigned[0], 0xff);
    await assert.rejects(async () => sdk.Messages.sign(sender, unsigned), sdk.InvalidArgument);

    // The transaction's own signature does not verify as a message signature of its bytes.
    const signed = await draft.sign(sender);
    const signature = hex(signed.bytes.slice(unsigned.length, unsigned.length + 64));
    const claimed = {
      message: unsigned,
      publicKey: sender.publicKey,
      signature,
      algorithm: "secp256k1-bip340-sha256",
      network: "heartwood-devnet-v90",
    };
    assert.equal(await sdk.Messages.verify(claimed), false);
    await sender.release();
  });

  test("a signed transaction that comes back is checked against the draft that was sent", async () => {
    const { TRANSFER } = await load();
    const { chain, sender, draft } = await build(sdk, TRANSFER, transfer(TRANSFER));
    const back = await sdk.SignedTransaction.deserialize((await draft.sign(sender)).serialize(), chain.profile);
    assert.equal(await back.matches(draft), true);
    // Another draft of the same sender and nonce, signed in its place, does not match.
    const other = (await build(sdk, TRANSFER, { ...transfer(TRANSFER), memo: "another memo" })).draft;
    assert.equal(await back.matches(other), false);
    const swapped = await sdk.SignedTransaction.deserialize((await other.sign(sender)).serialize(), chain.profile);
    assert.equal(await swapped.matches(draft), false);
    await sender.release();
  });

  test("drafts apply the network's rules before anything is signed", async () => {
    const { TRANSFER } = await load();
    const chain = await sdk.Chain.load(sdk.profiles.devnet({ relays: [RELAY] }), data().configuration);
    const sender = await sdk.Keys.fromLegacyPassphrase("probe passphrase", chain);
    const facts = { sender, nonce: 1n, height: 2 };
    const to = [{ address: TRANSFER.request.operation.to[0].address, amount: 1n }];
    const code = async (request) => {
      try {
        await sdk.Draft.build(chain, request, facts);
        return "built";
      } catch (error) {
        assert.ok(error instanceof sdk.IceRootError);
        return error.code;
      }
    };
    assert.equal(await code({ operation: { kind: "transfer", to: [] }, fee: 1n }), "NoRecipients");
    assert.equal(await code({ operation: { kind: "transfer", to: Array(257).fill(to[0]) }, fee: 1n }), "TooManyRecipients");
    assert.equal(await code({ operation: { kind: "transfer", to }, memo: "x".repeat(256), fee: 1n }), "MemoTooLong");
    assert.equal(
      await code({ operation: { kind: "transfer", to: [{ address: "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNX", amount: 1n }] }, fee: 1n }),
      "InvalidAddress",
    );
    assert.equal(await code({ operation: { kind: "vote", entries: [{ validator: "a", basisPoints: 5000 }] }, fee: 1n }), "InvalidVote");
    assert.equal(await code({ operation: { kind: "register-validator", name: "Not A Name" }, fee: 1n }), "InvalidName");
    assert.equal(await code({ operation: { kind: "transfer", to }, fee: -1n }), "InvalidArgument");
    assert.equal(await code({ operation: { kind: "swap" }, fee: 1n }), "InvalidArgument");

    // "minimum" is the exact floor of the milestone in force.
    const minimum = await sdk.Draft.build(chain, { operation: { kind: "transfer", to } }, facts);
    const floor = (85n + BigInt(Math.ceil(minimum.size / 2))) * 6173n;
    assert.equal(minimum.fee, floor);
    assert.deepEqual({ ...minimum.summary.fee }, { amount: floor, source: "floor", floor });
    const scaled = await sdk.Draft.build(chain, { operation: { kind: "transfer", to }, fee: { multiplierBasisPoints: 15_000 } }, facts);
    assert.equal(scaled.fee, (floor * 15_000n + 9_999n) / 10_000n);
    assert.equal(scaled.summary.fee.source, "explicit");
    assert.equal(scaled.summary.fee.floor, floor);
    assert.equal((await chain.rules(2)).fees.floorAvailable, true);
    await sender.release();
  });

  test("without an enabled fee table there is no floor, and only an exact fee builds", async () => {
    const { TRANSFER } = await load();
    const configuration = structuredClone(data().configuration);
    for (const milestone of configuration.milestones) {
      delete milestone.dynamicFees;
    }
    const chain = await sdk.Chain.load(sdk.profiles.devnet({ relays: [RELAY] }), configuration);
    const rules = await chain.rules(2);
    assert.equal(rules.fees.dynamic, null);
    assert.equal(rules.fees.floorAvailable, false);
    const sender = await sdk.Keys.fromLegacyPassphrase("probe passphrase", chain);
    const facts = { sender, nonce: 1n, height: 2 };
    const to = [{ address: TRANSFER.request.operation.to[0].address, amount: 1n }];
    const burn = { kind: "burn", amount: 2_000_000n };
    for (const operation of [{ kind: "transfer", to }, burn]) {
      for (const fee of [undefined, "minimum", { multiplierBasisPoints: 15_000 }]) {
        await assert.rejects(
          async () => sdk.Draft.build(chain, { operation, ...(fee === undefined ? {} : { fee }) }, facts),
          (error) => error instanceof sdk.FeeUnavailable && error.code === "FeeUnavailable",
          `${operation.kind} ${JSON.stringify(fee)}`,
        );
      }
    }
    const exact = await sdk.Draft.build(chain, { operation: { kind: "transfer", to }, fee: 1_000_000n }, facts);
    assert.deepEqual({ ...exact.summary.fee }, { amount: 1_000_000n, source: "explicit" });

    // A burn with no fee, whose form claims the floor, stays explicit: never a zero fee called the floor.
    const free = await sdk.Draft.build(chain, { operation: burn, fee: 0n }, facts);
    const form = new TextDecoder().decode(free.serialize()).replace('"source":"explicit"', '"source":"floor"');
    const read = await sdk.Draft.deserialize(new TextEncoder().encode(form), chain.profile);
    assert.deepEqual({ ...read.summary.fee }, { amount: 0n, source: "explicit" });
    await sender.release();
  });

  test("a serialized draft's fee is called the floor only when it is", async () => {
    const { TRANSFER } = await load();
    const chain = await sdk.Chain.load(sdk.profiles.devnet({ relays: [RELAY] }), data().configuration);
    const sender = await sdk.Keys.fromLegacyPassphrase("probe passphrase", chain);
    const facts = { sender, nonce: 1n, height: 2 };
    const to = [{ address: TRANSFER.request.operation.to[0].address, amount: 1n }];
    const text = (draft) => new TextDecoder().decode(draft.serialize());
    const read = async (form) => (await sdk.Draft.deserialize(new TextEncoder().encode(form), chain.profile)).summary.fee;

    const minimum = await sdk.Draft.build(chain, { operation: { kind: "transfer", to } }, facts);
    assert.deepEqual(await read(text(minimum)), minimum.summary.fee);

    // A fee above the floor that the form calls the floor reads as explicit, beside the floor.
    const above = await sdk.Draft.build(chain, { operation: { kind: "transfer", to }, fee: 2_000_000n }, facts);
    const form = text(above);
    assert.ok(form.includes('"source":"explicit"'));
    const claimed = await read(form.replace('"source":"explicit"', '"source":"floor"'));
    assert.deepEqual({ ...claimed }, { amount: 2_000_000n, source: "explicit", floor: minimum.fee });

    // Any source other than the floor, such as the removed "node-statistics", reads as explicit.
    for (const source of ["node-statistics", "cheapest"]) {
      const other = await read(text(minimum).replace('"source":"floor"', `"source":"${source}"`));
      assert.deepEqual({ ...other }, { amount: minimum.fee, source: "explicit", floor: minimum.fee });
    }
    await sender.release();
  });

  test("chains load, pin and describe the network", async () => {
    await load();
    const devnet = sdk.profiles.devnet({ relays: [RELAY] });
    const chain = await sdk.Chain.load(devnet, JSON.stringify(data().configuration));
    assert.equal(chain.profile.chain.nethash, data().nethash);
    assert.ok(Object.isFrozen(chain.profile));
    assert.equal(chain.networkByte, 90);
    assert.equal(chain.token.assetId, sdk.AssetId.ROOT);
    assert.equal(await chain.stageAt(2), "s1");
    assert.ok(chain.capabilities.has("transfer"));
    assert.equal(chain.capabilities.has("finality"), false);
    const rules = await chain.rules(2);
    assert.equal(rules.memo.maxBytes, 255);
    assert.equal(rules.transfer.maxRecipients, 256);
    assert.equal(typeof rules.maxAmount, "bigint");
    const economics = await chain.economics(2);
    assert.equal(typeof economics.minBurn, "bigint");
    assert.ok(economics.seats > 0);
    await assert.rejects(async () => chain.rules(0), sdk.InvalidArgument);
    await assert.rejects(
      async () => sdk.Chain.load(sdk.profiles.devnet({ relays: [RELAY], nethash: "ab".repeat(32) }), data().configuration),
      sdk.NetworkMismatch,
    );
    await assert.rejects(async () => sdk.Chain.load(devnet, "{}"), sdk.BadResponse);

    // A configuration with more seats than any network has is refused before anything is computed
    // per seat (the plugin's own check belongs to its Rust side).
    if (env.wasm) {
      const seats = (count) => {
        const configuration = structuredClone(data().configuration);
        for (const milestone of configuration.milestones) {
          milestone.activeDelegates = count;
          delete milestone.dynamicReward;
        }
        return configuration;
      };
      assert.equal((await (await sdk.Chain.load(devnet, seats(1000))).economics(2)).seats, 1000);
      await assert.rejects(async () => sdk.Chain.load(devnet, seats(1001)), sdk.BadResponse);
      await assert.rejects(async () => sdk.Chain.load(devnet, seats(3_000_000)), sdk.BadResponse);
    }
  });
}
