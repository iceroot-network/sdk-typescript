import { test } from "node:test";
import assert from "node:assert/strict";
import * as sdk from "../../dist/node/index.js";
import * as glue from "../../dist/node/iceroot_sdk.js";

await sdk.init();
test("the shipping entry exports checked links without fixed signing randomness", () => {
  assert.equal(typeof sdk.Link.build, "function");
  assert.equal(typeof sdk.InvalidLink, "function");
  assert.equal(glue.KeyHandle.prototype.signLinkWithAux, undefined);
  const profile = sdk.profiles.devnet({ relays: ["https://node.example/api"] });
  const account = sdk.Keys.fromLegacyPassphrase("example link holder", profile);
  try {
    const now = new Date("2026-09-26T12:34:56Z");
    const message = sdk.Link.build({ githubId: 9999999001, publicKey: account.publicKey, issuedAt: now }, profile);
    const record = sdk.Link.sign(account, message, { now });
    assert.equal(sdk.Link.verify(record, profile, { githubId: 9999999001 }, now).account, account.address);
    assert.throws(() => sdk.Messages.sign(account, message), sdk.InvalidArgument);
  } finally { account.release(); }
});

test("the classic script exports the same checked link API", async () => {
  const { default: vm } = await import("node:vm");
  const { readFileSync } = await import("node:fs");
  const context = vm.createContext({ atob, URL, TextEncoder, TextDecoder, WebAssembly, FinalizationRegistry, crypto: globalThis.crypto });
  context.globalThis = context;
  context.self = context;
  for (const name of ["iceroot-sdk.js", "iceroot-sdk-bytes.js"]) {
    vm.runInContext(readFileSync(new URL("../../dist/iife/" + name, import.meta.url), "utf8"), context);
  }
  const classic = context.IceRootSdk;
  classic.initSync(context.IceRootSdkWasmBytes);
  assert.equal(typeof classic.Link.build, "function");
  assert.equal(typeof classic.InvalidLink, "function");
  assert.throws(() => classic.Link.fromJson("{}"), error => error instanceof classic.InvalidLink && error.reason === "json");
});
