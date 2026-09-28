// The wrapper's own behaviour (test/suites/api.js) through the WebAssembly builds, and the missing
// randomness path, which needs a Node process without crypto.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import suite from "../suites/api.js";
import { nodeEnv } from "./env.mjs";
import { root } from "./helpers.mjs";

const RELAY = "http://127.0.0.1:4003/api";

suite(test, await nodeEnv());

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
