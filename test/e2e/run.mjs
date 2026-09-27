#!/usr/bin/env node
// The end-to-end tests against a local devnet:
//
//   ICEROOT_DEVNET_TOOLS=<devnet tooling> npm run test:e2e [-- --only node,chromium,quickstarts,wallet,rust]
//
// Node and Chromium run the scenario of scenario.js at the same time, each funded by its own
// genesis wallet. Then the documentation's quickstarts (quickstarts.e2e.ts) run, funded by the third
// genesis wallet, then the example wallet (wallet.e2e.ts) from the same one, and last the Rust
// SDK's end-to-end test, which also verifies the messages the TypeScript scenarios signed and reads
// their transactions back. The node allows 100 requests a
// minute from one address, so only the two scenarios run at the same time. Build the package
// first (npm run build).
//
// Without a devnet in the environment (ICEROOT_E2E_RELAY), this script runs itself through
// sdk-rust's tools/e2e/devnet.sh, from the sdk-rust checkout next to this repository or from
// SDK_RUST_DIR. That harness generates a fresh devnet, stops it when the tests end or when the
// chain has run five rounds, and removes it; see its header for the settings.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sdkRust = resolve(process.env.SDK_RUST_DIR ?? join(root, "..", "sdk-rust"));
const JOBS = ["node", "chromium", "quickstarts", "wallet", "rust"];
const { values } = parseArgs({ options: { only: { type: "string", default: JOBS.join(",") } } });
const selected = new Set(values.only.split(",").map((name) => name.trim()));
for (const name of selected) {
  if (!JOBS.includes(name)) {
    fail(`--only takes ${JOBS.join(", ")}, not ${name}`);
  }
}

function fail(message) {
  console.error(`e2e: ${message}`);
  process.exit(2);
}

/** Runs a command with its output lines prefixed; resolves to its exit status. */
function run(label, command, args, env = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) {
      let rest = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        const lines = (rest + chunk).split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) {
          console.log(`[${label}] ${line}`);
        }
      });
      stream.on("end", () => rest && console.log(`[${label}] ${rest}`));
    }
    child.on("error", (error) => {
      console.log(`[${label}] could not start ${command}: ${error.message}`);
      resolvePromise(127);
    });
    child.on("close", (code, signal) => resolvePromise(code ?? (signal ? 128 : 1)));
  });
}

if (process.env.ICEROOT_E2E_RELAY === undefined) {
  const harness = join(sdkRust, "tools", "e2e", "devnet.sh");
  if (!existsSync(harness)) {
    fail(`no devnet harness at ${harness}: check out sdk-rust next to this repository or set SDK_RUST_DIR`);
  }
  for (const build of [join(root, "dist", "node", "index.js"), join(root, "dist", "web", "index.js"), join(root, "dist", "iife", "iceroot-sdk-bytes.js")]) {
    if (!existsSync(build)) {
      fail(`${build} is missing: run npm run build first`);
    }
  }
  const child = spawn(harness, ["run", "--", process.execPath, fileURLToPath(import.meta.url), `--only=${values.only}`], {
    cwd: root,
    stdio: "inherit",
  });
  child.on("close", (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
} else {
  const results = [];
  const scenarios = [];
  const typescript = [];
  if (selected.has("node")) {
    typescript.push(
      run("node", process.execPath, ["--test", "--test-reporter=spec", "test/e2e/node.e2e.mjs"], { ICEROOT_E2E_FUNDER: "genesis-1" }).then(
        (status) => scenarios.push(["Node", status]),
      ),
    );
  }
  if (selected.has("chromium")) {
    const playwright = join(root, "node_modules", ".bin", "playwright");
    typescript.push(
      run("chromium", playwright, ["test", "-c", "playwright.e2e.config.ts", "test/e2e/chromium.e2e.ts"], {
        ICEROOT_E2E_FUNDER: "genesis-2",
      }).then((status) => scenarios.push(["Chromium", status])),
    );
  }
  await Promise.all(typescript);
  results.push(...scenarios);
  if (selected.has("quickstarts")) {
    const playwright = join(root, "node_modules", ".bin", "playwright");
    const status = await run("quickstarts", playwright, ["test", "-c", "playwright.e2e.config.ts", "test/e2e/quickstarts.e2e.ts"], {
      ICEROOT_E2E_FUNDER: "team-placeholder-1",
    });
    results.push(["Quickstarts", status]);
  }
  if (selected.has("wallet")) {
    const playwright = join(root, "node_modules", ".bin", "playwright");
    const status = await run("wallet", playwright, ["test", "-c", "playwright.e2e.config.ts", "test/e2e/wallet.e2e.ts"], {
      ICEROOT_E2E_FUNDER: "team-placeholder-1",
    });
    results.push(["Example wallet", status]);
  }
  if (selected.has("rust")) {
    // Every TypeScript scenario that passed left a signed message and its transactions.
    const passed = scenarios.filter(([, status]) => status === 0).length;
    const status = await run(
      "rust",
      "cargo",
      ["test", "--manifest-path", join(sdkRust, "Cargo.toml"), "-p", "iceroot-sdk", "--features", "e2e", "--test", "e2e", "--", "--ignored", "--nocapture"],
      { ICEROOT_E2E_FUNDER: "team-placeholder-1", ICEROOT_E2E_EXPECT_ARTIFACTS: String(passed * 2) },
    );
    results.push(["Rust", status]);
  }
  for (const [name, status] of results) {
    console.log(`e2e: ${name} ${status === 0 ? "passed" : `FAILED (status ${status})`}`);
  }
  process.exit(results.every(([, status]) => status === 0) ? 0 : 1);
}
