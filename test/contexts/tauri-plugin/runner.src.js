// The test page of the Tauri plugin check, bundled into frontend/runner.js by run.mjs. It runs, in
// the webview, through the SDK's Tauri entry and the plugin, what the control server's /config
// asks for:
//
// - "published": the native vectors (test/shared/vector-checks.js) through the published entry
//   and the published plugin, which must have no test seam;
// - "test": the vectors through the test entry and the plugin's test build, then the SDK's test
//   suites (test/suites), the same code the Node tests run through WebAssembly;
// - "e2e": the devnet scenario (test/e2e/scenario.js) against a local devnet.
//
// The page reaches the control server only (the recorded nodes' routes, the suites' files, the
// raw node JSON of the end-to-end test); every request to a node leaves from the plugin.

import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { createBase58check } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToEntropy, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import "../../shared/vector-checks.js";
import "../../shared/ownership-checks.js";
import assert from "../../suites/assert.js";
import api from "../../suites/api.js";
import client from "../../suites/client.js";
import crosscheck from "../../suites/crosscheck.js";
import keystoreSuite from "../../suites/keystore.js";
import ownershipSuite from "../../suites/ownership.js";
import plugin from "./plugin-suite.js";
import transactions from "../../suites/transactions.js";
import voteSuite from "../../suites/vote.js";
import { runScenario } from "../../e2e/scenario.js";

const CONTROL = "http://127.0.0.1:6010";
// The commands of the plugin's test build only (feature test-seams).
const SEAMS = [
  "seam_sha256",
  "seam_key_sign_message_with_aux",
  "seam_draft_sign_with_aux",
  "seam_proof_key_sign_with_aux",
  "seam_vote_library",
  "seam_vote_snapshot_from_relay",
  "seam_keystore_constants",
  "seam_keystore_encrypt_with_salt_and_nonce",
  "seam_keystore_decrypt_with_bounds",
  "seam_keystore_check_params_with_bounds",
];
const logArea = document.getElementById("log");

function log(line) {
  logArea.textContent += `${line}\n`;
  fetch(`${CONTROL}/log`, { method: "POST", body: JSON.stringify({ line }) }).catch(() => {});
}

async function control(path, value) {
  const response = await fetch(`${CONTROL}${path}`, value === undefined ? {} : { method: "POST", body: JSON.stringify(value) });
  if (!response.ok) {
    throw new Error(`control ${path}: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function read(path) {
  const response = await fetch(`${CONTROL}/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw new Error(`no file ${path}`);
  }
  return response.text();
}

/** A recorded node of the control server, as test/suites expect one. */
async function node(routes = {}, vars = {}) {
  const { id, relay } = await control("/node", { routes, vars });
  return {
    relay,
    options: {},
    route: (key, value) => control(`/node/${id}/route`, { key, value }),
    set: (values) => control(`/node/${id}/set`, { values }),
    requests: () => control(`/node/${id}/requests`),
  };
}

/**
 * The failover tests' relays: nothing listens on port 6099; the busy node answers 503; the moved
 * node answers every request with a redirect to the target node.
 */
async function relays() {
  const busy = await node({ "*": { status: 503, headers: {}, body: JSON.stringify({ statusCode: 503, error: "Service Unavailable", message: "busy" }) } });
  const working = await node();
  const target = await node();
  const moved = await node({ "*": { status: 307, headers: { location: `${target.relay}/node/configuration/crypto` }, body: "" } });
  return {
    down: "http://127.0.0.1:6099/api",
    busy: busy.relay,
    moved: moved.relay,
    working: working.relay,
    options: {},
    tried: async () => undefined,
    busyRequests: async () => (await busy.requests()).length,
    movedRequests: async () => (await moved.requests()).length,
    targetRequests: async () => (await target.requests()).length,
    // The plugin's client is set to follow none; the target's requests show it.
    redirectModes: async () => undefined,
  };
}

/** Runs the tests `suite` defines; each result `{ suite, name, ok, ms, error? , skipped? }`. */
async function runSuite(label, suite, env) {
  const tests = [];
  const define = (name, options, fn) => tests.push({ name, fn: fn ?? options, options: fn === undefined ? {} : options });
  suite(define, env);
  const results = [];
  for (const { name, fn, options } of tests) {
    if (options.skip) {
      results.push({ suite: label, name, ok: true, skipped: String(options.skip), ms: 0 });
      continue;
    }
    const started = performance.now();
    try {
      await fn();
      results.push({ suite: label, name, ok: true, ms: Math.round(performance.now() - started) });
      log(`ok   ${label}: ${name}`);
    } catch (error) {
      results.push({ suite: label, name, ok: false, ms: Math.round(performance.now() - started), error: String(error?.stack ?? error) });
      log(`FAIL ${label}: ${name}: ${error?.message ?? error}`);
    }
  }
  return results;
}

/** The SDK's Tauri entry in vendor/<dir>, next to the bundled page, imported as it is. */
async function vendor(dir) {
  const load = (file) => import(new URL(`./vendor/${dir}/${file}`, import.meta.url).href);
  const [sdk, vote, keystore, ownership] = await Promise.all([load("index.js"), load("vote.js"), load("keystore.js"), load("ownership.js")]);
  await sdk.init();
  return { sdk, vote, keystore, ownership };
}

async function main() {
  const config = await control("/config");
  const vectors = JSON.parse(await read("ts/test/vectors/wasm-native.json"));
  const report = { mode: config.mode, userAgent: navigator.userAgent };
  const published = await vendor("sdk");

  if (config.mode === "published") {
    const { sdk, vote, keystore } = published;
    report.vectors = await globalThis.IceRootVectorChecks.run({ ...sdk, vote, keystore }, vectors, "tauri-plugin-published");
    // The published plugin has no test seam: each is refused.
    const answered = [];
    let refusal = "";
    for (const seam of SEAMS) {
      try {
        await window.__TAURI_INTERNALS__.invoke(`plugin:iceroot|${seam}`, {});
        answered.push(seam);
      } catch (error) {
        refusal = String(error);
      }
    }
    report.seam = answered.length === 0 ? `refused: ${SEAMS.length} seams, ${refusal}` : `answered: ${answered.join(", ")}`;
    // Nor does the published entry export the test entry's seams.
    report.entrySeams = Object.keys(sdk).filter((name) => /^(seam|testing)|WithAux$|Seam/.test(name));
    // A command the plugin refuses reads as SdkNotInitialized through the entry's own call path:
    // a seam, through the test entry's wrapper, against the published plugin.
    const testEntry = await import(new URL("./vendor/sdk-test/index.js", import.meta.url).href);
    report.refusedThroughEntry = await testEntry.testing.sha256("refused").then(
      () => "answered",
      (error) => (error instanceof testEntry.SdkNotInitialized && error.code === "SdkNotInitialized" ? "SdkNotInitialized" : `${error?.name}: ${error?.message}`),
    );
    report.version = await sdk.bindingsVersion();
    return report;
  }

  if (config.mode === "test") {
    const test = await vendor("sdk-test");
    report.vectors = await globalThis.IceRootVectorChecks.run({ ...test.sdk, vote: test.vote, keystore: test.keystore }, vectors, "tauri-plugin-test");
    const env = {
      kind: "tauri",
      ...published,
      testSdk: test.sdk,
      otherSdk: published.sdk,
      assert,
      read,
      node,
      relays,
      noble: { schnorr, secp256k1, ripemd160, sha256, bytesToHex, hexToBytes, utf8ToBytes, createBase58check },
      scure: { entropyToMnemonic, mnemonicToEntropy, mnemonicToSeedSync, validateMnemonic, wordlist, HDKey },
      ownershipChecks: globalThis.IceRootOwnershipChecks,
      slow: 5,
      wasm: false,
    };
    const suites = { api, transactions, vote: voteSuite, keystore: keystoreSuite, ownership: ownershipSuite, crosscheck, client, plugin };
    const only = config.only === undefined ? Object.keys(suites) : config.only;
    report.tests = [];
    for (const name of only) {
      report.tests.push(...(await runSuite(name, suites[name], env)));
    }
    return report;
  }

  if (config.mode === "e2e") {
    const { sdk } = published;
    // The raw node JSON of a forged transaction, through the control server: the page reaches no node.
    const nodeTransport = async (url) => {
      const answer = await control("/proxy", { url });
      return new Response(answer.body, { status: answer.status, headers: answer.retryAfter === null ? {} : { "retry-after": answer.retryAfter } });
    };
    // The second context: the plugin reads the draft again from its bytes and signs with a key it
    // derives; the page only passes bytes.
    const signElsewhere = async ({ draft, profile, phrase, account, index }) => {
      const received = await sdk.Draft.deserialize(draft, profile);
      const key = await sdk.Keys.fromPhrase(phrase, profile, { account, index });
      try {
        return { signed: (await received.sign(key)).serialize(), lines: received.summary.lines };
      } finally {
        await key.release();
      }
    };
    report.scenario = await runScenario({
      sdk,
      relay: config.relay,
      label: config.label,
      funderPassphrase: config.funder,
      maxHeight: config.maxHeight,
      signElsewhere,
      log,
      nodeTransport,
    });
    return report;
  }
  throw new Error(`no mode ${config.mode}`);
}

const output = document.getElementById("report");
main().then(
  (report) => {
    output.textContent = JSON.stringify(report, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
    output.dataset.done = "true";
  },
  (error) => {
    log(`FAILED: ${error?.stack ?? error}`);
    output.textContent = JSON.stringify({ error: String(error?.stack ?? error) });
    output.dataset.done = "true";
  },
);
