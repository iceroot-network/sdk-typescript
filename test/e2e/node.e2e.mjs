// The devnet end-to-end scenario in Node 22, through the Node build of the package. The second
// WebAssembly instance, which signs a draft it receives as bytes, is the browser build loaded
// from its bytes: it shares nothing with the first and never reaches the network.
//
// Run by run.mjs against a devnet the harness started; see scenario.js for what it checks.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as sdk from "../../dist/node/index.js";
import * as signerSdk from "../../dist/web/index.js";
import { dist } from "../node/helpers.mjs";
import { e2eEnvironment, writeArtifacts } from "./environment.mjs";
import { openNode } from "./node-api.js";
import { runScenario } from "./scenario.js";

test("the devnet scenario in Node", { timeout: 40 * 60_000 }, async () => {
  const environment = e2eEnvironment("genesis-1");
  await signerSdk.init(readFileSync(join(dist, "web", "iceroot_sdk_bg.wasm")));

  async function signElsewhere({ draft, profile, phrase, account, index }) {
    const received = signerSdk.Draft.deserialize(draft, profile);
    const key = signerSdk.Keys.fromPhrase(phrase, profile, { account, index });
    try {
      return { signed: received.sign(key).serialize(), lines: received.summary.lines };
    } finally {
      key.release();
    }
  }

  const report = await runScenario({
    sdk,
    node: openNode(environment.relay),
    label: "node",
    funderPassphrase: environment.funderPassphrase,
    maxHeight: environment.maxHeight,
    signElsewhere,
    log: (line) => console.log(line),
  });
  writeArtifacts(environment.artifacts, report);
});
