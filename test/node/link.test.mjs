import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as sdk from "../../build/test/dist/node/index.js";
import * as glue from "../../build/test/dist/node/iceroot_sdk.js";
import { runLinks } from "../shared/link-checks.js";

await sdk.init();
const records = readFileSync(new URL("../../../sdk-rust/vectors/sdk/S09-account-links.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
test("all account link vectors through the public functions", () => {
  assert.equal(runLinks(sdk, glue, records, assert.deepEqual), 113);
});
test("native records and fresh checked signatures", () => {
  const cases = JSON.parse(readFileSync(new URL("../vectors/wasm-native.json", import.meta.url), "utf8")).links;
  assert.equal(cases.length, 3);
  const profile = sdk.profiles.devnet({ relays: ["https://node.example/api"] });
  const account = sdk.Keys.fromLegacyPassphrase("example link holder", profile);
  try {
    for (const item of cases) {
      const record = sdk.Link.fromJson(item.json);
      assert.equal(sdk.Link.toJson(record), item.json);
      assert.equal(sdk.Link.verify(item.json, profile, {}, 1790512497000).githubId, item.githubId);
      const signed = sdk.Link.sign(account, item.message, { now: 1790512497000 });
      const original = glue.KeyHandle.prototype.signLink;
      try {
        glue.KeyHandle.prototype.signLink = function (message, now) {
          return this.signLinkWithAux(message, now, new Uint8Array(32).fill(0x42));
        };
        assert.equal(sdk.Link.toJson(sdk.Link.sign(account, item.message, { now: 1790512497000 })), item.json);
      } finally { glue.KeyHandle.prototype.signLink = original; }
      assert.equal(sdk.Link.verify(signed, profile, {}, 1790512497000).kind, item.revocation ? "revocation" : "link");
    }
  } finally { account.release(); }
});
test("record limits, exact escaping, clocks and released keys", () => {
  const profile = sdk.profiles.devnet({ relays: ["https://node.example/api"] });
  const account = sdk.Keys.fromLegacyPassphrase("example link holder", profile);
  const now = 1790512497000;
  const message = sdk.Link.build({ githubId: 9999999001, publicKey: account.publicKey, issuedAt: new Date(now) }, profile);
  const signed = sdk.Link.sign(account, message, { now });
  const json = sdk.Link.toJson(signed);
  const bytes = new TextEncoder().encode(json).length;
  assert.deepEqual(sdk.Link.fromJson(json + " ".repeat(16384 - bytes)), signed);
  assert.throws(() => sdk.Link.fromJson(json + " ".repeat(16385 - bytes)), error => error instanceof sdk.InvalidLink && error.reason === "json");
  for (const text of ["x".repeat(4097), "é".repeat(2049)]) {
    assert.throws(() => sdk.Link.parse(text, profile, {}, now), error => error.reason === "format");
  }
  const escaped = { ...signed, message: '\n"\\\b\f\r\t\u0001\u001f\u007fé\u2028/' };
  assert.equal(sdk.Link.toJson(escaped), JSON.stringify(escaped));
  for (const clock of [NaN, Infinity, 0.5, 8640000000000001, new Date(NaN)]) {
    assert.throws(() => sdk.Link.sign(account, message, { now: clock }), sdk.InvalidArgument);
  }
  for (const githubId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    assert.throws(() => sdk.Link.build({ githubId, publicKey: account.publicKey, issuedAt: new Date(now) }, profile), error => error instanceof sdk.InvalidLink && error.reason === "github-id");
  }
  assert.equal(sdk.Link.parse(message, profile, {}, now - 30000).githubId, 9999999001);
  assert.throws(() => sdk.Link.parse(message, profile, {}, now - 30001), error => error.reason === "future");
  assert.throws(() => sdk.Link.sign(account, new Uint8Array(32), { now }), sdk.InvalidArgument);
  account.release();
  assert.throws(() => sdk.Link.sign(account, message, { now }), sdk.KeyReleased);
});
test("arguments that are not objects are refused as SDK errors", () => {
  const profile = sdk.profiles.devnet({ relays: ["https://node.example/api"] });
  const account = sdk.Keys.fromLegacyPassphrase("example link holder", profile);
  try {
    const now = 1790512497000;
    const message = sdk.Link.build({ githubId: 9999999001, publicKey: account.publicKey, issuedAt: new Date(now) }, profile);
    for (const value of [null, undefined, "9999999001"]) {
      assert.throws(() => sdk.Link.build(value, profile), sdk.InvalidArgument);
      assert.throws(() => sdk.Link.buildRevocation(value, profile), sdk.InvalidArgument);
      assert.throws(() => sdk.Link.sign(account, message, value), sdk.InvalidArgument);
    }
  } finally { account.release(); }
});
