// Drafts and signed transactions through WebAssembly against the native Rust vectors: a transfer
// and a vote built and signed in Node reproduce the native transactions byte for byte (test build),
// the published build signs with fresh randomness over the same unsigned bytes, and a draft built
// in one module instance is signed in another that has no network, as an extension's sandbox does.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as sdk from "../../dist/node/index.js";
import * as testSdk from "../../build/test/dist/node/index.js";
import * as webSdk from "../../dist/web/index.js";
import { dist, vectors } from "./helpers.mjs";

const RELAY = "http://127.0.0.1:4003/api";
const data = vectors.transactions;
const byName = (fragment) => {
  const found = data.cases.find((txCase) => txCase.name.startsWith(fragment));
  assert.ok(found, fragment);
  return found;
};
const TRANSFER = byName("transfer to two recipients");
const AT_FLOOR = byName("transfer at the fee floor");
const VOTE = byName("vote for three validators");
const SECOND = byName("transfer signed with a second key");

const hex = (bytes) => Buffer.from(bytes).toString("hex");

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

function build(module, txCase, request) {
  const chain = module.Chain.load(module.profiles.devnet({ relays: [RELAY] }), data.configuration);
  const sender = account(module, txCase.signer, chain);
  const facts = {
    sender,
    nonce: BigInt(txCase.facts.nonce),
    height: txCase.facts.height,
    ...(txCase.facts.secondKey === null ? {} : { secondKey: txCase.facts.secondKey }),
  };
  return { chain, sender, draft: module.Draft.build(chain, request, facts) };
}

test("a transfer and a vote built and signed in WebAssembly are the native transactions", () => {
  for (const [txCase, request] of [
    [TRANSFER, transfer(TRANSFER)],
    [AT_FLOOR, transfer(AT_FLOOR)],
    [VOTE, vote(VOTE)],
  ]) {
    const { chain, sender, draft } = build(testSdk, txCase, request);
    assert.equal(chain.nethash, data.nethash);
    assert.equal(hex(draft.unsignedBytes), txCase.unsigned, txCase.name);
    const signed = testSdk.testing.signDraftWithAux(draft, sender, Buffer.from(txCase.aux, "hex"));
    assert.equal(signed.id, txCase.id, txCase.name);
    assert.equal(hex(signed.bytes), txCase.bytes, txCase.name);
    assert.deepEqual(signed.json, txCase.json, txCase.name);
    assert.equal(signed.verified, true);
    assert.equal(testSdk.testing.sha256(draft.serialize()), txCase.draftSha256);
    assert.equal(testSdk.testing.sha256(signed.serialize()), txCase.signedSha256);
    sender.release();
  }
});

test("the review summary is computed from the transaction's own fields", () => {
  const { chain, sender, draft } = build(sdk, TRANSFER, transfer(TRANSFER));
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
  const voteDraft = build(sdk, VOTE, vote(VOTE)).draft;
  assert.deepEqual(
    voteDraft.summary.operation.entries.map((entry) => entry.validator),
    VOTE.summary.operation.entries.map((entry) => entry.validator),
  );
  assert.deepEqual(voteDraft.summary.lines.slice(0, 3), ["Vote 50% for genesis_1", "Vote 25% for genesis_10", "Vote 25% for genesis_2"]);
  sender.release();
});

test("review lines escape control and bidirectional characters", () => {
  const memo = "refund\nFee 0 ROOT \u202Eexe.pdf\u2066x\u2069 \\ \u0000\u0085\u2028 冰根 עברית";
  const request = { ...transfer(TRANSFER), memo };
  const { chain, sender, draft } = build(sdk, TRANSFER, request);
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
  sender.release();
});

test("the published build signs the native unsigned bytes with fresh randomness", () => {
  for (const [txCase, request] of [
    [TRANSFER, transfer(TRANSFER)],
    [VOTE, vote(VOTE)],
  ]) {
    const { sender, draft } = build(sdk, txCase, request);
    const one = draft.sign(sender);
    const two = draft.sign(sender);
    for (const signed of [one, two]) {
      assert.equal(signed.verified, true);
      assert.equal(hex(signed.bytes).slice(0, txCase.unsigned.length), txCase.unsigned);
      assert.equal(signed.summary.from, txCase.summary.from);
      assert.equal(signed.summary.nonce, BigInt(txCase.summary.nonce));
    }
    assert.notEqual(one.id, two.id);
    assert.equal("testing" in sdk, false);
    sender.release();
  }
});

test("a draft built in one module instance is signed in another with no network", async () => {
  // The Node build and the browser build are separate WebAssembly instances.
  await webSdk.init(readFileSync(join(dist, "web", "iceroot_sdk_bg.wasm")));
  const { chain, draft } = build(sdk, SECOND, transfer(SECOND));
  const bytes = draft.serialize();

  // The signing context knows only the pinned profile, passed as a plain object.
  const profile = structuredClone(chain.profile);
  const received = webSdk.Draft.deserialize(bytes, profile);
  assert.deepEqual(received.summary.lines, draft.summary.lines);
  assert.equal(received.summary.secondSignature, true);
  const key = account(webSdk, SECOND.signer, profile);
  const second = account(webSdk, SECOND.secondSigner, profile);
  assert.throws(() => received.sign(key), webSdk.WrongKey);
  const signed = received.sign(key, { secondKey: second });
  assert.equal(signed.verifySecondSignature(second.publicKey), true);

  // Back where the network is.
  const back = sdk.SignedTransaction.deserialize(signed.serialize(), chain.profile);
  assert.equal(back.id, signed.id);
  assert.equal(back.verified, true);
  assert.equal(hex(back.bytes).slice(0, SECOND.unsigned.length), SECOND.unsigned);

  // Another network's profile refuses the draft.
  const other = sdk.profiles.devnet({ relays: [RELAY], nethash: "00".repeat(32) });
  assert.throws(() => sdk.Draft.deserialize(bytes, other), sdk.NetworkMismatch);
  assert.throws(() => sdk.Draft.deserialize(bytes, sdk.profiles.devnet({ relays: [RELAY] })), sdk.NetworkMismatch);
  assert.throws(() => sdk.Draft.deserialize(bytes.slice(0, 20), chain.profile), sdk.IceRootError);
  key.release();
  second.release();
});

test("drafts apply the network's rules before anything is signed", () => {
  const chain = sdk.Chain.load(sdk.profiles.devnet({ relays: [RELAY] }), data.configuration);
  const sender = sdk.Keys.fromLegacyPassphrase("probe passphrase", chain);
  const facts = { sender, nonce: 1n, height: 2 };
  const to = [{ address: TRANSFER.request.operation.to[0].address, amount: 1n }];
  const code = (request, statistics) => {
    try {
      sdk.Draft.build(chain, request, facts, statistics);
      return "built";
    } catch (error) {
      assert.ok(error instanceof sdk.IceRootError);
      return error.code;
    }
  };
  assert.equal(code({ operation: { kind: "transfer", to: [] }, fee: 1n }), "NoRecipients");
  assert.equal(code({ operation: { kind: "transfer", to: Array(257).fill(to[0]) }, fee: 1n }), "TooManyRecipients");
  assert.equal(code({ operation: { kind: "transfer", to }, memo: "x".repeat(256), fee: 1n }), "MemoTooLong");
  assert.equal(code({ operation: { kind: "transfer", to: [{ address: "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNX", amount: 1n }] }, fee: 1n }), "InvalidAddress");
  assert.equal(code({ operation: { kind: "vote", entries: [{ validator: "a", basisPoints: 5000 }] }, fee: 1n }), "InvalidVote");
  assert.equal(code({ operation: { kind: "register-validator", name: "Not A Name" }, fee: 1n }), "InvalidName");
  assert.equal(code({ operation: { kind: "transfer", to }, fee: -1n }), "InvalidArgument");
  assert.equal(code({ operation: { kind: "swap" }, fee: 1n }), "InvalidArgument");

  // "minimum" is the exact floor of the milestone in force, whatever the node's statistics say.
  const statistics = {
    entries: [
      { kind: "transfer", avg: 2n, min: 1n, max: 3_000_000n, sum: 0n, burned: 0n },
      { kind: "other", avg: 9n, min: 9n, max: 9n, sum: 9n, burned: 0n },
    ],
  };
  const minimum = sdk.Draft.build(chain, { operation: { kind: "transfer", to } }, facts);
  const floor = (85n + BigInt(Math.ceil(minimum.size / 2))) * 6173n;
  assert.equal(minimum.fee, floor);
  assert.deepEqual({ ...minimum.summary.fee }, { amount: floor, source: "floor", floor });
  const withStatistics = sdk.Draft.build(chain, { operation: { kind: "transfer", to } }, facts, statistics);
  assert.equal(withStatistics.fee, floor);
  assert.equal(withStatistics.summary.fee.source, "floor");
  const scaled = sdk.Draft.build(chain, { operation: { kind: "transfer", to }, fee: { multiplierBasisPoints: 15_000 } }, facts);
  assert.equal(scaled.fee, (floor * 15_000n + 9_999n) / 10_000n);
  assert.equal(scaled.summary.fee.source, "explicit");
  assert.equal(scaled.summary.fee.floor, floor);
  assert.equal(chain.rules(2).fees.floorAvailable, true);
  sender.release();
});

test("a serialized draft's fee is called the floor only when it is", () => {
  const chain = sdk.Chain.load(sdk.profiles.devnet({ relays: [RELAY] }), data.configuration);
  const sender = sdk.Keys.fromLegacyPassphrase("probe passphrase", chain);
  const facts = { sender, nonce: 1n, height: 2 };
  const to = [{ address: TRANSFER.request.operation.to[0].address, amount: 1n }];
  const text = (draft) => new TextDecoder().decode(draft.serialize());
  const read = (form) => sdk.Draft.deserialize(new TextEncoder().encode(form), chain.profile).summary.fee;

  const minimum = sdk.Draft.build(chain, { operation: { kind: "transfer", to } }, facts);
  assert.deepEqual(read(text(minimum)), minimum.summary.fee);

  // A fee above the floor that the form calls the floor reads as explicit, beside the floor.
  const above = sdk.Draft.build(chain, { operation: { kind: "transfer", to }, fee: 2_000_000n }, facts);
  const form = text(above);
  assert.ok(form.includes('"source":"explicit"'));
  const claimed = read(form.replace('"source":"explicit"', '"source":"floor"'));
  assert.deepEqual({ ...claimed }, { amount: 2_000_000n, source: "explicit", floor: minimum.fee });
  sender.release();
});

test("chains load, pin and describe the network", () => {
  const devnet = sdk.profiles.devnet({ relays: [RELAY] });
  const chain = sdk.Chain.load(devnet, JSON.stringify(data.configuration));
  assert.equal(chain.profile.chain.nethash, data.nethash);
  assert.ok(Object.isFrozen(chain.profile));
  assert.equal(chain.networkByte, 90);
  assert.equal(chain.token.assetId, sdk.AssetId.ROOT);
  assert.equal(chain.stageAt(2), "s1");
  assert.ok(chain.capabilities.has("transfer"));
  assert.equal(chain.capabilities.has("finality"), false);
  const rules = chain.rules(2);
  assert.equal(rules.memo.maxBytes, 255);
  assert.equal(rules.transfer.maxRecipients, 256);
  assert.equal(typeof rules.maxAmount, "bigint");
  const economics = chain.economics(2);
  assert.equal(typeof economics.minBurn, "bigint");
  assert.ok(economics.seats > 0);
  assert.throws(() => chain.rules(0), sdk.InvalidArgument);
  assert.throws(
    () => sdk.Chain.load(sdk.profiles.devnet({ relays: [RELAY], nethash: "ab".repeat(32) }), data.configuration),
    sdk.NetworkMismatch,
  );
  assert.throws(() => sdk.Chain.load(devnet, "{}"), sdk.BadResponse);
});
