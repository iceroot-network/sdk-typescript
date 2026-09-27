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
      assert.deepEqual({ ...error.details }, { reason: "wrong-network" });
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
