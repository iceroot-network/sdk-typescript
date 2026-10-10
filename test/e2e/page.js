// The devnet end-to-end scenario in Chromium, through the browser build of the package, under the
// page policy script-src 'self' 'wasm-unsafe-eval' with the devnet's API in connect-src.
//
// The second WebAssembly instance runs in a worker served with connect-src 'none', as a Manifest
// V3 sandbox page is: it loads the classic-script build and its embedded bytes, receives drafts as
// bytes and the recovery phrase, and returns signed transactions as bytes. The page first shows
// that the worker cannot reach the network.
//
// Query: relay, funder (a genesis wallet's passphrase), label, maxHeight.

import * as sdk from "/dist/web/index.js";

import { runScenario } from "./scenario.js";

const params = new URLSearchParams(location.search);
const output = document.getElementById("report");
const logArea = document.getElementById("log");

function log(line) {
  console.log(line);
  logArea.textContent += `${line}\n`;
}

function signingWorker() {
  const worker = new Worker("/sandboxed/test/e2e/signer-worker.js");
  const pending = new Map();
  let next = 0;
  worker.onmessage = ({ data }) => {
    const waiting = pending.get(data.id);
    pending.delete(data.id);
    if (data.error === undefined) {
      waiting.resolve(data.result);
    } else {
      waiting.reject(new Error(data.error));
    }
  };
  worker.onerror = (event) => {
    for (const waiting of pending.values()) {
      waiting.reject(new Error(`the signing worker failed: ${event.message}`));
    }
    pending.clear();
  };
  return (request) =>
    new Promise((resolve, reject) => {
      next += 1;
      pending.set(next, { resolve, reject });
      worker.postMessage({ id: next, request });
    });
}

async function main() {
  await sdk.init();
  const relay = params.get("relay");
  const worker = signingWorker();
  const probe = await worker({ probe: `${relay}/node/status` });
  const report = await runScenario({
    sdk,
    relay,
    label: params.get("label"),
    funderPassphrase: params.get("funder"),
    maxHeight: Number(params.get("maxHeight")),
    signElsewhere: worker,
    log,
  });
  return { ...report, workerReachedNetwork: probe.fetched };
}

main().then(
  (report) => {
    output.textContent = JSON.stringify(report, (_, value) => (typeof value === "bigint" ? value.toString() : value));
    output.dataset.done = "true";
  },
  (error) => {
    log(`FAILED: ${error?.stack ?? error}`);
    output.textContent = JSON.stringify({ error: String(error?.message ?? error) });
    output.dataset.done = "true";
  },
);
