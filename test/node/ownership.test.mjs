// Ownership proofs through WebAssembly: every record of the ownership proof vectors (sdk-rust's
// vectors/sdk/S08-ownership-proofs.jsonl, whose verdicts come from the IceRoot Legacy Signer's own
// format checks and whose keys, addresses and signatures come from the reference implementation)
// through the published functions, and the signing records through the test build's seam for
// fixed auxiliary randomness; the round trips of a proof; the wiping of a passphrase given as bytes;
// and the error codes.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as sdk from "../../dist/node/index.js";
import * as ownership from "../../dist/node/ownership.js";
import * as testSdk from "../../build/test/dist/node/index.js";
import { root } from "./helpers.mjs";

const VECTORS = join(root, "..", "sdk-rust", "vectors", "sdk", "S08-ownership-proofs.jsonl");
if (!existsSync(VECTORS)) {
  throw new Error(`the ownership proof vectors are missing: check out sdk-rust next to this repository (${VECTORS})`);
}
const { testing } = testSdk;

// The records the Legacy Signer accepts and the SDK refuses on purpose, as sdk-rust's runner lists
// them: the signer reads the source address by its pattern only, the issue time with JavaScript's
// Date.parse (which rolls impossible dates over), and a typed account with Unicode toLowerCase.
const STRICTER = new Set([
  "an S address of network byte 62",
  "address with a bad checksum",
  "issued on 30 February",
  "issued on 29 February of a common year",
  "issued at 24:00:00",
  "in capitals with a Kelvin sign for K",
]);

const fromHex = (text) => new Uint8Array(Buffer.from(text, "hex"));

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
    assert.ok(error instanceof ownership.InvalidProof || error instanceof testSdk.ownership.InvalidProof, String(error));
    assert.equal(error.code, "InvalidProof");
    assert.equal(error.reason, error.details.reason);
    return { refused: error.reason };
  }
}

/** Compares a record with an outcome: `matched`, `divergent` (a documented stricter refusal) or a failure message. */
function judge(record, result) {
  if (record.error === undefined) {
    if (result.output !== undefined) {
      assert.deepEqual(result.output, record.output, record.name);
      return "matched";
    }
    assert.ok(STRICTER.has(record.name), `${record.name}: refused (${result.refused}) where the vectors accept`);
    return "divergent";
  }
  assert.equal(result.output, undefined, `${record.name}: accepted where the vectors refuse`);
  return "matched";
}

test("every ownership proof vector runs in WebAssembly", () => {
  assert.ok(testing.hasFixedAux());
  const tally = { matched: 0, divergent: 0 };
  const count = (verdict) => (tally[verdict] += 1);
  for (const record of records()) {
    const input = record.input;
    switch (record.op) {
      case "proof.account":
        count(judge(record, outcome(() => ({ ...ownership.IceRootAccount.parse(input.text) }))));
        break;
      case "proof.build":
        count(
          judge(
            record,
            outcome(() => ({
              message: ownership.OwnershipProof.build({
                address: input.address,
                account: input.account,
                nonce: input.nonce,
                issuedAt: input.issuedAtMs,
              }),
            })),
          ),
        );
        break;
      case "proof.parse":
        count(
          judge(
            record,
            outcome(() => ({
              network: ownership.SOURCE_NETWORK,
              ...ownership.OwnershipProof.parse(input.message, input.expected, input.now),
            })),
          ),
        );
        break;
      case "proof.sign": {
        const key = testSdk.ownership.SolarKey.fromPassphrase(input.passphrase);
        try {
          const result = outcome(() => testing.signProofWithAux(key, input.message, input.now, fromHex(input.aux)));
          if (result.output !== undefined) {
            const proof = result.output;
            const json = testSdk.ownership.OwnershipProof.toJson(proof);
            // The JSON reads back as the same proof, which verifies; the signature alone makes the
            // same proof, as a Ledger's signature is checked; and the published build agrees.
            assert.deepEqual(ownership.OwnershipProof.fromJson(json), proof);
            assert.deepEqual(
              ownership.OwnershipProof.fromSignature(proof.message, proof.publicKey, proof.signature, input.now),
              proof,
            );
            assert.equal(ownership.OwnershipProof.verify(json, input.now).address, key.address);
            assert.equal(ownership.sourceAddress(key.publicKey), key.address);
            result.output = { proof: JSON.parse(json), json };
          }
          count(judge(record, result));
        } finally {
          key.release();
        }
        break;
      }
      case "proof.verify": {
        const verdict = outcome(() => ownership.OwnershipProof.verify(JSON.stringify(input.proof), input.now));
        assert.deepEqual({ valid: verdict.output !== undefined }, record.output, record.name);
        count("matched");
        break;
      }
      default:
        assert.fail(`unknown operation ${record.op}`);
    }
  }
  assert.deepEqual(tally, { matched: 112, divergent: 7 });
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
