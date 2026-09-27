// The wrapper's own behaviour: profiles, errors, released keys and missing randomness.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import * as sdk from "../../dist/node/index.js";
import { root } from "./helpers.mjs";

const RELAY = "http://127.0.0.1:4003/api";

test("devnet profiles are checked and frozen", () => {
  const devnet = sdk.profiles.devnet({ relays: [`${RELAY}/`] });
  assert.deepEqual(devnet.api.relays, [RELAY]);
  assert.equal(devnet.chain.networkByte, 90);
  assert.equal(devnet.backend, "solar-compat");
  assert.equal(devnet.keyScheme, "bip32-secp256k1");
  assert.equal(devnet.coinType, 1);
  assert.ok(Object.isFrozen(devnet) && Object.isFrozen(devnet.chain) && Object.isFrozen(devnet.api.relays));

  for (const options of [
    { relays: [] },
    { relays: ["not a url"] },
    { relays: ["ftp://127.0.0.1/api"] },
    { relays: [RELAY], networkByte: 256 },
    { relays: [RELAY], networkByte: 1.5 },
    { relays: [RELAY], nethash: "ABC" },
  ]) {
    assert.throws(() => sdk.profiles.devnet(options), sdk.InvalidProfile, JSON.stringify(options));
  }
});

test("errors carry stable codes and details", () => {
  const devnet = sdk.profiles.devnet({ relays: [RELAY] });
  assert.throws(
    () => sdk.Address.parse("dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF", sdk.profiles.devnet({ relays: [RELAY], networkByte: 30 })),
    (error) => {
      assert.ok(error instanceof sdk.InvalidAddress && error instanceof sdk.IceRootError && error instanceof Error);
      assert.equal(error.code, "InvalidAddress");
      assert.equal(error.name, "InvalidAddress");
      assert.equal(error.reason, "wrong-network");
      assert.deepEqual({ ...error.details }, { reason: "wrong-network", expected: 30, actual: 90 });
      return true;
    },
  );
  assert.throws(() => sdk.Address.fromPublicKey("02zz", devnet), sdk.InvalidPublicKey);
  assert.throws(() => sdk.Address.fromPublicKey("05" + "11".repeat(32), devnet), sdk.InvalidPublicKey);
  assert.throws(() => sdk.Keys.fromLegacyPassphrase(Uint8Array.of(0xff), devnet), sdk.InvalidPhrase);
});

test("the legacy import is refused where the key scheme is not classical", () => {
  const pq = { ...sdk.profiles.devnet({ relays: [RELAY] }), id: "devnet-pq", keyScheme: "slip10-mldsa65" };
  const bytes = new TextEncoder().encode("probe passphrase");
  assert.throws(() => sdk.Keys.fromLegacyPassphrase(bytes, pq), (error) => {
    assert.ok(error instanceof sdk.UnsupportedOnNetwork);
    assert.equal(error.capability, "legacy-passphrase-import");
    return true;
  });
  assert.ok(bytes.every((byte) => byte === 0));
});

test("a released account keeps its address and refuses to sign", () => {
  const devnet = sdk.profiles.devnet({ relays: [RELAY] });
  const account = sdk.Keys.fromLegacyPassphrase("probe passphrase", devnet);
  const connected = { profile: devnet };
  assert.equal(sdk.Address.parse(account.address, connected).toString(), account.address);
  assert.equal(account.released, false);
  account.release();
  account.release();
  assert.equal(account.released, true);
  assert.equal(account.address, "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF");
  assert.equal(account.publicKeyBytes.length, 33);
  assert.throws(() => sdk.Messages.sign(account, "x"), sdk.KeyReleased);
});

test("message verification never throws on malformed input", () => {
  const devnet = sdk.profiles.devnet({ relays: [RELAY] });
  const account = sdk.Keys.fromLegacyPassphrase("probe passphrase", devnet);
  const signed = { ...sdk.Messages.sign(account, "hello"), message: "hello" };
  assert.equal(sdk.Messages.verify(signed), true);
  assert.equal(sdk.Messages.verify(signed, devnet), true);
  assert.equal(sdk.Messages.verify(signed, sdk.profiles.devnet({ relays: [RELAY], networkByte: 30 })), false);
  assert.equal(sdk.Messages.verify({ ...signed, algorithm: "ml-dsa-65" }), false);
  assert.equal(sdk.Messages.verify({ ...signed, signature: "zz" }), false);
  assert.equal(sdk.Messages.verify({ ...signed, signature: signed.signature.slice(2) }), false);
  assert.equal(sdk.Messages.verify({ ...signed, publicKey: "" }), false);
  account.release();
});

test("signing without randomness fails closed with RandomnessUnavailable", () => {
  const script = `
    delete globalThis.crypto;
    const sdk = await import("./dist/node/index.js");
    const account = sdk.Keys.fromLegacyPassphrase("probe passphrase", sdk.profiles.devnet({ relays: ["${RELAY}"] }));
    const codes = [];
    for (let i = 0; i < 2; i++) {
      try { sdk.Messages.sign(account, "x"); codes.push("signed"); } catch (error) { codes.push(error.code); }
    }
    process.stdout.write(JSON.stringify(codes));
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), ["RandomnessUnavailable", "RandomnessUnavailable"]);
});

test("recovery phrases: new phrases, form feedback and derived accounts", () => {
  const devnet = sdk.profiles.devnet({ relays: [RELAY] });
  const phrase = sdk.Mnemonic.generate();
  assert.equal(phrase.split(" ").length, 24);
  assert.notEqual(sdk.Mnemonic.generate(), phrase);
  assert.deepEqual({ ...sdk.Mnemonic.check(phrase) }, { ok: true, words: 24 });
  const twelve = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  assert.deepEqual({ ...sdk.Mnemonic.check(twelve) }, { ok: false, words: 12, reason: "too-short" });
  assert.throws(() => sdk.Keys.fromPhrase(twelve, devnet), (error) => {
    assert.ok(error instanceof sdk.PhraseTooShort);
    assert.deepEqual({ ...error.details }, { words: 12, minimum: 18 });
    assert.equal(error.message.includes("abandon"), false);
    return true;
  });
  const typo = phrase.replace(/\S+$/, "zzzz");
  assert.throws(() => sdk.Keys.fromPhrase(typo, devnet), (error) => {
    assert.ok(error instanceof sdk.InvalidPhrase);
    assert.equal(error.details.reason, "unknown-word");
    assert.equal(error.details.position, 24);
    assert.equal(error.message.includes("zzzz"), false);
    return true;
  });

  const first = sdk.Keys.fromPhrase(phrase, devnet);
  const second = sdk.Keys.fromPhrase(phrase, devnet, { index: 1 });
  assert.equal(first.path, "m/44'/1'/0'/0'/0'");
  assert.equal(second.path, "m/44'/1'/0'/0'/1'");
  assert.notEqual(first.address, second.address);
  assert.equal(first.legacy, false);
  assert.equal(sdk.Address.fromPublicKey(first.publicKey, devnet).toString(), first.address);
  assert.throws(() => sdk.Keys.fromPhrase(phrase, devnet, { account: -1 }), sdk.InvalidArgument);
  const bytes = new TextEncoder().encode(phrase);
  assert.throws(() => sdk.Keys.fromPhrase(bytes, devnet, { index: 2 ** 31 }), sdk.InvalidArgument);
  assert.ok(bytes.every((byte) => byte === 0));
  first.release();
  second.release();
});

test("amounts are exact", () => {
  assert.equal(sdk.Amount.parse("1.5", 8), 150_000_000n);
  assert.equal(sdk.Amount.format(150_000_000n, 8), "1.5");
  assert.equal(sdk.Amount.format(123_456_789_012_345_678n, 8, { maxFraction: 2, grouping: true }), "1,234,567,890.12");
  assert.throws(() => sdk.Amount.parse("1.123456789", 8), sdk.InvalidAmount);
  assert.throws(() => sdk.Amount.parse("1", 1.5), sdk.InvalidArgument);
  assert.throws(() => sdk.Amount.format(-1n, 8), sdk.InvalidAmount);
  assert.throws(() => sdk.Amount.format(1n, 8, { maxFraction: 256 }), sdk.InvalidArgument);
  assert.equal(sdk.AssetId.ROOT, "ROOT");
});

test("capabilities come from the profile", () => {
  const devnet = sdk.profiles.devnet({ relays: [RELAY] });
  const capabilities = sdk.capabilitiesOf(devnet);
  for (const name of ["transfer", "vote", "burn", "message-signing", "legacy-passphrase-import", "phrase-accounts"]) {
    assert.equal(capabilities.has(name), true, name);
  }
  for (const name of ["finality", "names", "swaps", "transaction-id-before-signing"]) {
    assert.equal(capabilities.has(name), false, name);
  }
  assert.ok(capabilities.list().includes("transfer"));
  assert.equal(sdk.messageNetworkOf(devnet), "heartwood-devnet-v90");
  assert.equal(sdk.messageAlgorithmOf(devnet), "secp256k1-bip340-sha256");
  const later = { ...devnet, id: "devnet-pq", keyScheme: "slip10-mldsa65" };
  assert.deepEqual([...sdk.capabilitiesOf(later).list()], []);
  assert.throws(() => sdk.Address.parse("dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF", later), sdk.UnsupportedOnNetwork);
  assert.throws(() => sdk.capabilitiesOf({ ...devnet, backend: "other" }), sdk.InvalidProfile);
});

test("sign-in messages are built and checked by the same code", () => {
  const devnet = sdk.profiles.devnet({ relays: [RELAY] });
  const account = sdk.Keys.fromLegacyPassphrase("probe passphrase", devnet);
  const issuedAt = new Date("2026-09-27T10:00:00Z");
  const expiresAt = new Date("2026-09-27T10:05:00Z");
  const nonce = "ab".repeat(32);
  const message = sdk.SignIn.build(
    { origin: "https://validators.example", publicKey: account.publicKey, nonce, issuedAt, expiresAt },
    devnet,
  );
  assert.equal(message.split("\n").length, 12);
  const now = new Date("2026-09-27T10:01:00Z");
  const fields = sdk.SignIn.parse(message, devnet, {
    origin: "https://validators.example",
    address: account.address,
    publicKey: account.publicKey,
    now,
  });
  assert.equal(fields.nonce, nonce);
  assert.equal(fields.address, account.address);
  assert.equal(fields.issuedAt.getTime(), issuedAt.getTime());
  assert.equal(fields.network, "heartwood-devnet-v90");
  const signature = sdk.Messages.sign(account, message);
  assert.equal(sdk.Messages.verify({ ...signature, message }, devnet), true);

  const selected = {
    origin: "https://validators.example",
    address: account.address,
    publicKey: account.publicKey,
    now,
  };
  for (const expected of [
    { ...selected, origin: "https://other.example" },
    { ...selected, address: "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNX" },
    { ...selected, publicKey: "02" + "11".repeat(32) },
    { ...selected, now: new Date("2026-09-27T10:10:00Z") },
  ]) {
    assert.throws(() => sdk.SignIn.parse(message, devnet, expected), (error) => {
      assert.ok(error instanceof sdk.InvalidSignIn);
      assert.equal(typeof error.details.reason, "string");
      return true;
    });
  }
  assert.throws(() => sdk.SignIn.parse(message.replace("Version: 1", "Version: 2"), devnet, selected), sdk.InvalidSignIn);
  assert.throws(() => sdk.SignIn.parse(message, devnet, { ...selected, now: new Date(Number.NaN) }), sdk.InvalidArgument);
  // The origin and the identity are always compared: leaving one out is refused, never skipped.
  for (const field of ["origin", "address", "publicKey"]) {
    const { [field]: _left, ...partial } = selected;
    assert.throws(() => sdk.SignIn.parse(message, devnet, partial), (error) => {
      assert.ok(error instanceof sdk.InvalidArgument);
      assert.equal(error.details.field, field);
      return true;
    });
    assert.throws(() => sdk.SignIn.parse(message, devnet, { ...selected, [field]: "" }), sdk.InvalidArgument);
  }
  account.release();
});
