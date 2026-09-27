// Ownership proofs through WebAssembly: every record of the ownership proof vectors (sdk-rust's
// vectors/sdk/S08-ownership-proofs.jsonl, whose verdicts come from the IceRoot Legacy Signer's own
// format checks and whose keys, addresses and signatures come from the reference implementation)
// through the published functions, and the signing records through the test build's seam for
// fixed auxiliary randomness, with the checks Chromium runs too; the round trips of a proof; the
// wiping of a passphrase given as bytes; and the error codes.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as sdk from "../../dist/node/index.js";
import * as ownership from "../../dist/node/ownership.js";
import * as testSdk from "../../build/test/dist/node/index.js";
import { root } from "./helpers.mjs";
import "../shared/ownership-checks.js";

const VECTORS = join(root, "..", "sdk-rust", "vectors", "sdk", "S08-ownership-proofs.jsonl");
if (!existsSync(VECTORS)) {
  throw new Error(`the ownership proof vectors are missing: check out sdk-rust next to this repository (${VECTORS})`);
}
const { testing } = testSdk;

function records() {
  const lines = readFileSync(VECTORS, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const [meta, ...rest] = lines;
  assert.equal(meta.class, "S08-ownership-proofs");
  assert.equal(meta.sourceNetworkByte, ownership.SOLAR_NETWORK_BYTE);
  assert.equal(rest.length, meta.records);
  return rest;
}

/** The output of `fn`, or `{ refused: reason }` for an `InvalidProof`. Any other error fails. */
function outcome(fn) {
  try {
    return { output: fn() };
  } catch (error) {
    assert.ok(error instanceof ownership.InvalidProof, String(error));
    assert.equal(error.code, "InvalidProof");
    assert.equal(error.reason, error.details.reason);
    return { refused: error.reason };
  }
}

test("every ownership proof vector runs in WebAssembly", () => {
  assert.ok(testing.hasFixedAux());
  // The same checks as in Chromium (test/shared/ownership-checks.js).
  const report = globalThis.IceRootOwnershipChecks.run(ownership, { ...testing, ownership: testSdk.ownership }, records());
  assert.deepEqual(report.failures, []);
  // 112 records match; 7 are the documented cases where the SDK is stricter than the Legacy Signer.
  assert.deepEqual(report.tally, { matched: 112, divergent: 7 });
});

test("a proof is built, signed with fresh randomness, verified and read back", () => {
  const passphrase = new TextEncoder().encode("ownership proof round trip");
  const key = ownership.SolarKey.fromPassphrase(passphrase);
  assert.ok(passphrase.every((byte) => byte === 0), "the passphrase bytes are wiped");
  assert.match(key.address, /^S[1-9A-HJ-NP-Za-km-z]{33}$/);
  const now = new Date("2026-09-27T08:00:00.000Z");
  const account = ownership.IceRootAccount.parse("  TICE1XXY02TYLS8D0P0JK8DWXNQJQTS8LY4E87648J8ZQDD7MNFNDXSYQPJ8XTY ");
  assert.deepEqual({ ...account }, { account: "tice1xxy02tyls8d0p0jk8dwxnqjqts8ly4e87648j8zqdd7mnfndxsyqpj8xty", network: "testnet" });
  const nonce = ownership.OwnershipProof.randomNonce();
  assert.match(nonce, /^[0-9a-f]{64}$/);
  const message = ownership.OwnershipProof.build({ address: key.address, account: account.account, nonce, issuedAt: now });
  assert.match(message, /\nIssued at: 2026-09-27T08:00:00\.000Z\n/);
  const fields = ownership.OwnershipProof.parse(message, { address: key.address }, now);
  assert.equal(fields.issuedAtMs, now.getTime());
  assert.equal(fields.accountNetwork, "testnet");

  const proof = ownership.OwnershipProof.sign(key, message, now);
  const json = ownership.OwnershipProof.toJson(proof);
  assert.equal(
    json,
    JSON.stringify({
      type: ownership.PROOF_TYPE,
      version: ownership.PROOF_VERSION,
      network: ownership.SOURCE_NETWORK,
      address: proof.address,
      publicKey: proof.publicKey,
      algorithm: ownership.PROOF_ALGORITHM,
      message,
      signature: proof.signature,
    }),
  );
  assert.deepEqual(ownership.OwnershipProof.verify(proof, now), fields);
  // Signed again with fresh randomness: another signature, the same proof otherwise.
  const again = ownership.OwnershipProof.sign(key, message, now);
  assert.notEqual(again.signature, proof.signature);
  // Another message's signature does not make a proof.
  const other = ownership.OwnershipProof.build({ address: key.address, account: account.account, nonce: ownership.OwnershipProof.randomNonce(), issuedAt: now });
  assert.equal(outcome(() => ownership.OwnershipProof.fromSignature(other, proof.publicKey, proof.signature, now)).refused, "signature");
  key.release();
  assert.ok(key.released);
  assert.throws(() => ownership.OwnershipProof.sign(key, message, now), (error) => error instanceof sdk.KeyReleased);
});

test("refusals carry the reason, and wrong arguments are InvalidArgument", () => {
  assert.equal(outcome(() => ownership.IceRootAccount.parseCanonical("ICE1XXY02TYLS8D0P0JK8DWXNQJQTS8LY4E87648J8ZQDD7MNFNDXSYQV4QS2H")).refused, "account");
  assert.equal(outcome(() => ownership.sourceAddress("04" + "00".repeat(32))).refused, "key");
  assert.equal(outcome(() => ownership.OwnershipProof.fromJson("{}")).refused, "json");
  assert.equal(outcome(() => ownership.OwnershipProof.parse("not a proof", {}, Date.now())).refused, "format");
  for (const call of [
    () => ownership.OwnershipProof.parse("x", {}, Number.NaN),
    () => ownership.OwnershipProof.parse("x", { address: "" }, 0),
    () => ownership.OwnershipProof.build(null),
    () => ownership.SolarKey.fromPassphrase(42),
  ]) {
    assert.throws(call, (error) => error instanceof sdk.InvalidArgument);
  }
  // The published build has no seam for fixed randomness.
  assert.equal(typeof sdk.testing, "undefined");
});
