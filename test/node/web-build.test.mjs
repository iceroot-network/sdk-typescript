// The browser build under Node: explicit initialization from bytes, and the errors before it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as sdk from "../../dist/web/index.js";
import * as keystore from "../../dist/web/keystore.js";
import * as vote from "../../dist/web/vote.js";
import { assertReport, checks, dist, vectors } from "./helpers.mjs";

const devnet = sdk.profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] });

test("every entry point refuses to run before initialization", () => {
  assert.equal(sdk.isInitialized(), false);
  assert.throws(() => sdk.Keys.fromLegacyPassphrase("x", devnet), sdk.SdkNotInitialized);
  assert.throws(() => sdk.Address.parse("dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF", devnet), (error) => {
    assert.ok(error instanceof sdk.IceRootError);
    assert.equal(error.code, "SdkNotInitialized");
    return true;
  });
  assert.throws(() => sdk.bindingsVersion(), sdk.SdkNotInitialized);
});

test("a module that does not compile is reported and init can be retried", async () => {
  await assert.rejects(sdk.init(new Uint8Array([0, 97, 115, 109, 9, 9, 9, 9])), (error) => {
    assert.ok(error instanceof sdk.WasmLoadFailed);
    assert.ok(error.cause instanceof Error);
    return true;
  });
  assert.throws(() => sdk.initSync(new Uint8Array([1, 2, 3])), sdk.WasmLoadFailed);
  assert.equal(sdk.isInitialized(), false);
});

test("init(bytes) loads the module, once", async () => {
  const bytes = readFileSync(join(dist, "web", "iceroot_sdk_bg.wasm"));
  await Promise.all([sdk.init(bytes), sdk.init(bytes)]);
  assert.equal(sdk.isInitialized(), true);
  await sdk.init();
  sdk.initSync(new Uint8Array(0));
});

test("the browser build matches native Rust", () => {
  assertReport(assert, checks.run({ ...sdk, vote, keystore }, vectors, "node-web"), { fixedAux: false, voteAndKeystore: true });
});
