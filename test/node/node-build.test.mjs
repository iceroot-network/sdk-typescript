// The Node build (the package's "node" condition) against the native vectors.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as sdk from "../../dist/node/index.js";
import * as keystore from "../../dist/node/keystore.js";
import * as vote from "../../dist/node/vote.js";
import * as testSdk from "../../build/test/dist/node/index.js";
import { assertReport, checks, vectors } from "./helpers.mjs";

test("the Node build loads on import", async () => {
  assert.equal(sdk.isInitialized(), true);
  await sdk.init();
  sdk.initSync(new Uint8Array(0));
  assert.equal(sdk.VERSION, "0.1.0");
  assert.equal(sdk.bindingsVersion(), "0.1.0");
});

test("the published Node build matches native Rust", async () => {
  const report = await checks.run({ ...sdk, vote, keystore }, vectors, "node");
  assert.equal(report.hasFixedAux, false);
  assertReport(assert, report, { fixedAux: false, voteAndKeystore: true });
});

test("the test Node build signs byte for byte as native Rust", async () => {
  // The test build carries the vote library and the keystore as namespaces of its root.
  const report = await checks.run(testSdk, vectors, "node-test");
  assert.equal(report.hasFixedAux, true);
  assertReport(assert, report, { fixedAux: true, voteAndKeystore: true });
});

test("the published build has no keystore seam and no vote test helpers", async () => {
  assert.equal("vote" in sdk, false);
  assert.equal("keystore" in sdk, false);
  assert.equal(testSdk.testing.hasKeystoreSeam(), true);
});

test("the published build has no way to choose the signature randomness", async () => {
  assert.equal("testing" in sdk, false);
  const account = sdk.Keys.fromLegacyPassphrase("probe passphrase", sdk.profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] }));
  const one = sdk.Messages.sign(account, "same message");
  const two = sdk.Messages.sign(account, "same message");
  assert.notEqual(one.signature, two.signature);
  account.release();
});
