// The Node build (the package's "node" condition) against the native vectors.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as sdk from "../../dist/node/index.js";
import * as testSdk from "../../build/test/dist/node/index.js";
import { assertReport, checks, vectors } from "./helpers.mjs";

test("the Node build loads on import", async () => {
  assert.equal(sdk.isInitialized(), true);
  await sdk.init();
  sdk.initSync(new Uint8Array(0));
  assert.equal(sdk.VERSION, "0.1.0");
  assert.equal(sdk.bindingsVersion(), "0.1.0");
});

test("the published Node build matches native Rust", () => {
  const report = checks.run(sdk, vectors, "node");
  assert.equal(report.hasFixedAux, false);
  assertReport(assert, report, { fixedAux: false });
});

test("the test Node build signs byte for byte as native Rust", () => {
  const report = checks.run(testSdk, vectors, "node-test");
  assert.equal(report.hasFixedAux, true);
  assertReport(assert, report, { fixedAux: true });
});

test("the published build has no way to choose the signature randomness", () => {
  assert.equal("testing" in sdk, false);
  const account = sdk.Keys.fromLegacyPassphrase("probe passphrase", sdk.profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] }));
  const one = sdk.Messages.sign(account, "same message");
  const two = sdk.Messages.sign(account, "same message");
  assert.notEqual(one.signature, two.signature);
  account.release();
});
