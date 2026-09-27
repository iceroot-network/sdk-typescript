// The classic-script build and the embedded-bytes file, run as a worker would run them: two
// classic scripts in one global scope, then initSync with the embedded bytes. No fetch exists.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";

import { assertReport, dist, root, testDist, vectors } from "./helpers.mjs";

function loadClassicScripts(dir) {
  const context = vm.createContext({
    atob,
    URL,
    TextEncoder,
    TextDecoder,
    WebAssembly,
    FinalizationRegistry,
    crypto: globalThis.crypto,
    console,
  });
  context.globalThis = context;
  context.self = context;
  for (const file of [join(dir, "iife", "iceroot-sdk.js"), join(dir, "iife", "iceroot-sdk-bytes.js"), join(root, "test", "shared", "vector-checks.js")]) {
    vm.runInContext(readFileSync(file, "utf8"), context, { filename: file });
  }
  return context;
}

test("the embedded bytes are the shipped module", () => {
  const context = loadClassicScripts(dist);
  const embedded = Buffer.from(context.IceRootSdkWasmBytes);
  const module = readFileSync(join(dist, "iife", "iceroot-sdk_bg.wasm"));
  assert.ok(embedded.equals(module));
  const sums = readFileSync(join(dist, "SHA256SUMS"), "utf8");
  const digest = createHash("sha256").update(module).digest("hex");
  assert.match(sums, new RegExp(`^${digest}  iife/iceroot-sdk_bg.wasm$`, "m"));
});

test("the classic-script build adds one global, with the vote library and the keystore, and loads synchronously from the bytes", () => {
  const context = loadClassicScripts(dist);
  const sdk = context.IceRootSdk;
  assert.equal(typeof sdk.initSync, "function");
  assert.equal("wasm_bindgen" in context, false);
  assert.equal(sdk.isInitialized(), false);
  sdk.initSync(context.IceRootSdkWasmBytes);
  assert.equal(typeof sdk.vote.select, "function");
  assert.equal(typeof sdk.keystore.decrypt, "function");
  assertReport(assert, context.IceRootVectorChecks.run(sdk, vectors, "node-iife"), { fixedAux: false, voteAndKeystore: true });
});

test("the test classic-script build signs byte for byte as native Rust", () => {
  const context = loadClassicScripts(testDist);
  const sdk = context.IceRootSdk;
  sdk.initSync(context.IceRootSdkWasmBytes);
  assertReport(assert, context.IceRootVectorChecks.run(sdk, vectors, "node-iife-test"), { fixedAux: true, voteAndKeystore: true });
});
