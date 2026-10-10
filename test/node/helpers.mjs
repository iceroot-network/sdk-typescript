// Shared by the Node tests: the vectors, the checker and the build directories.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "../shared/vector-checks.js";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const dist = join(root, "dist");
export const testDist = join(root, "build", "test", "dist");
export const vectors = JSON.parse(readFileSync(join(root, "test", "vectors", "wasm-native.json"), "utf8"));
export const checks = globalThis.IceRootVectorChecks;

/**
 * Fails the test with the report's failures when the checks did not all pass. With
 * `voteAndKeystore`, the vote library's selections and the keystore were checked too.
 */
export function assertReport(assert, report, { fixedAux, voteAndKeystore = false }) {
  assert.equal(report.failures.length, 0, JSON.stringify(report.failures.slice(0, 5), null, 2));
  assert.ok(report.ok);
  const signatures = vectors.keys.reduce((sum, key) => sum + key.signatures.length, 0);
  assert.equal(report.verifiedSignatures, signatures);
  assert.equal(report.freshSignatures, signatures);
  assert.equal(report.fixedAuxSignatures, fixedAux ? signatures : 0);
  const transactions = vectors.transactions.cases.length;
  assert.equal(report.verifiedTransactions, transactions);
  assert.equal(report.freshTransactions, transactions);
  assert.equal(report.fixedAuxTransactions, fixedAux ? transactions : 0);
  assert.equal(report.phraseAccounts, vectors.phraseAccounts.length);
  assert.equal(report.voteSelections, voteAndKeystore ? vectors.vote.selections.length : 0);
  assert.equal(report.keystoresOpened, voteAndKeystore ? 1 : 0);
}
