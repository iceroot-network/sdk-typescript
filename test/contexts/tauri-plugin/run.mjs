#!/usr/bin/env node
// The Tauri plugin check on Linux: builds the example application of examples/tauri-plugin with its
// own page, and twice with a test page instead, on the published plugin (tauri-plugin-iceroot) and on
// its test build (feature test-seams), and drives them with tauri-driver and WebKitWebDriver in the
// container of the Tauri webview check. Build both package variants first.
//
//   node test/contexts/tauri-plugin/run.mjs [--only suite,suite]       (DOCKER="sudo docker")
//   node test/contexts/tauri-plugin/run.mjs --e2e                        (inside sdk-rust's devnet.sh)
//
// Without --e2e: the example's own page against a recorded devnet node (example-smoke.mjs); the
// native vectors through the published entry and plugin, which must have no test seam; then the
// vectors through the test entry and the plugin's test build, and the SDK's test
// suites (test/suites: the same code the Node tests run through WebAssembly) against recorded devnet
// nodes served next to the application. With --e2e: the devnet scenario (test/e2e/scenario.js)
// against the devnet the harness started (ICEROOT_E2E_RELAY and the rest, see test/e2e/run.mjs).
//
// The application builds from sdk-rust next to this repository (SDK_RUST_DIR), copied with this
// repository's example into build/tauri-plugin-check. Its dependencies are fetched on the host
// first (cargo fetch, with the host's access to heartwood-core), into the host's Cargo home
// (CARGO_HOME, else ~/.cargo); the container builds offline from that Cargo home, as the invoking
// user, and its target directory stays in build/tauri-plugin-target between runs.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const sdkRust = resolve(process.env.SDK_RUST_DIR ?? join(root, "..", "sdk-rust"));
const work = join(root, "build", "tauri-plugin-check");
const target = join(root, "build", "tauri-plugin-target");
const cargoHome = resolve(process.env.CARGO_HOME ?? join(homedir(), ".cargo"));
const image = "iceroot-sdk-tauri-check:2";
const docker = (process.env.DOCKER ?? "docker").split(" ");
const example = join(root, "examples", "tauri-plugin");
const workExample = join(work, "sdk-typescript", "examples", "tauri-plugin");
// The example with its own page, next to the one with the test page (the same relative path to sdk-rust).
const workPage = join(work, "sdk-typescript", "examples", "tauri-plugin-page");
const { values } = parseArgs({ options: { e2e: { type: "boolean", default: false }, only: { type: "string" } } });


function fail(message) {
  console.error(`tauri-plugin: ${message}`);
  process.exit(2);
}

function sh(args, options = {}) {
  const [command, ...rest] = [...docker, ...args];
  return execFileSync(command, rest, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
}

/** The files of a git checkout, its uncommitted ones included, without what it ignores. */
function trackedFiles(dir) {
  return execFileSync("git", ["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((file) => file !== "" && existsSync(join(dir, file)));
}

async function assemble() {
  for (const build of [join(root, "dist", "tauri", "index.js"), join(root, "build", "test", "dist", "tauri", "index.js")]) {
    if (!existsSync(build)) {
      fail(`${build} is missing: run npm run build and npm run build:test first`);
    }
  }
  if (!existsSync(join(sdkRust, "crates", "tauri-plugin-iceroot", "Cargo.toml"))) {
    fail(`no tauri-plugin-iceroot in ${sdkRust}: check out sdk-rust next to this repository or set SDK_RUST_DIR`);
  }
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  mkdirSync(target, { recursive: true });

  // sdk-rust as it is checked out, so the application's path dependency resolves as it does here.
  for (const file of trackedFiles(sdkRust)) {
    cpSync(join(sdkRust, file), join(work, "sdk-rust", file));
  }
  // What the page and the suites read: this repository's vectors, the example's configuration.
  for (const file of trackedFiles(root).filter((file) => file.startsWith("test/") || file.startsWith("wasm/examples/"))) {
    cpSync(join(root, file), join(work, "sdk-typescript", file));
  }

  // The example application as it is, with its own page and the package's Tauri entry.
  const sources = (source) => !source.includes(`${join("src-tauri", "target")}`) && !source.includes(`${join("src-tauri", "gen")}`);
  cpSync(join(example, "src-tauri"), join(workPage, "src-tauri"), { recursive: true, filter: sources });
  cpSync(join(example, "frontend"), join(workPage, "frontend"), { recursive: true, filter: (source) => !source.includes("vendor") });
  cpSync(join(root, "dist", "tauri"), join(workPage, "frontend", "vendor", "iceroot-sdk", "tauri"), { recursive: true });

  // The example application, with the test page instead of the example's own.
  cpSync(join(example, "src-tauri"), join(workExample, "src-tauri"), { recursive: true, filter: sources });
  const frontend = join(workExample, "frontend");
  mkdirSync(frontend, { recursive: true });
  cpSync(join(here, "frontend", "index.html"), join(frontend, "index.html"));
  cpSync(join(root, "dist", "tauri"), join(frontend, "vendor", "sdk"), { recursive: true });
  cpSync(join(root, "build", "test", "dist", "tauri"), join(frontend, "vendor", "sdk-test"), { recursive: true });
  await esbuild.build({
    entryPoints: [join(here, "runner.src.js")],
    outfile: join(frontend, "runner.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["./vendor/*"],
    logLevel: "warning",
  });

  // The test page reaches the control server next to the application (never a node), and the
  // plugin the recorded nodes, the relay that is down and a local devnet's relay.
  const config = JSON.parse(readFileSync(join(workExample, "src-tauri", "tauri.conf.json"), "utf8"));
  config.app.security.csp = config.app.security.csp.replace("connect-src 'self' ipc: http://ipc.localhost", "connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:6010");
  config.productName = "iceroot-sdk-tauri-plugin-check";
  writeFileSync(join(workExample, "src-tauri", "tauri.conf.json"), `${JSON.stringify(config, null, 2)}\n`);
  const capability = {
    identifier: "main",
    windows: ["main"],
    permissions: [
      "iceroot:default",
      // The keystore suite reads phrases back with decrypt, which the default set leaves out.
      "iceroot:allow-keystore-decrypt",
      { identifier: "iceroot:allow-net-connect", allow: [{ url: "http://127.0.0.1:6003/n/*/api" }, { url: "http://127.0.0.1:*/api" }] },
    ],
  };
  writeFileSync(join(workExample, "src-tauri", "capabilities", "main.json"), `${JSON.stringify(capability, null, 2)}\n`);
  // The test build's seams need their permission, which only the test build's capabilities grant.
  const seams = { identifier: "seams", windows: ["main"], permissions: ["iceroot:test-seams"] };
  writeFileSync(join(work, "seams.json"), `${JSON.stringify(seams, null, 2)}\n`);

  const harness = join(work, "harness");
  mkdirSync(harness, { recursive: true });
  for (const file of ["relay.mjs", "smoke.mjs", "example-smoke.mjs"]) {
    cpSync(join(here, file), join(harness, file));
  }
  cpSync(join(root, "test", "suites", "recorded-node.js"), join(harness, "recorded-node.js"));
}

function containerScript(runs, { examplePage = false } = {}) {
  const locked = existsSync(join(example, "src-tauri", "Cargo.lock")) ? "--locked" : "";
  const app = "/work/sdk-typescript/examples/tauri-plugin/src-tauri";
  const lines = [
    "set -e",
    // The example as it is, with its own page.
    ...(examplePage
      ? [
          "cd /work/sdk-typescript/examples/tauri-plugin-page/src-tauri",
          `cargo build --release ${locked}`,
          "cp /target/release/iceroot-sdk-tauri-plugin-example /work/app-example",
        ]
      : []),
    `cd ${app}`,
    `cargo build --release ${locked}`,
    "cp /target/release/iceroot-sdk-tauri-plugin-example /work/app-published",
    // The test build: the plugin's seams, and the capability that grants them.
    "cp /work/seams.json capabilities/seams.json",
    `node -e 'const f=process.argv[1];const c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.app.security.capabilities.push("seams");require("fs").writeFileSync(f,JSON.stringify(c,null,2))' tauri.conf.json`,
    `cargo build --release ${locked} --features test-seams`,
    "cp /target/release/iceroot-sdk-tauri-plugin-example /work/app-test",
    "ICEROOT_TAURI_CHECK_FILE=/work/config.json node /work/harness/relay.mjs /work/sdk-typescript /work/sdk-rust 6003 6010 > /work/relay.log 2>&1 &",
  ];
  if (examplePage) {
    lines.push("dbus-run-session -- xvfb-run -a node /work/harness/example-smoke.mjs /work/app-example | tee /work/example.log || true");
  }
  for (const { name, app: binary, config, seconds } of runs) {
    lines.push(`echo '${JSON.stringify(config)}' > /work/config.json`);
    lines.push(`dbus-run-session -- xvfb-run -a node /work/harness/smoke.mjs /work/${binary} ${seconds} | tee /work/${name}.log || true`);
  }
  return lines.join("\n");
}

/** Fetches the application's dependencies into the host's Cargo home, for the offline build. */
function fetchDependencies() {
  const manifest = join(workExample, "src-tauri", "Cargo.toml");
  const locked = existsSync(join(example, "src-tauri", "Cargo.lock")) ? ["--locked"] : [];
  execFileSync("cargo", ["fetch", ...locked, "--manifest-path", manifest], { stdio: ["ignore", "inherit", "inherit"] });
}

function runContainer(script, network) {
  // The container runs as the invoking user, so that what it writes in the Cargo home and the
  // target directory stays the user's; the session bus of the webview needs that user in the
  // container's user and group databases.
  const [uid, gid] = [process.getuid(), process.getgid()];
  writeFileSync(join(work, "passwd"), `${sh(["run", "--rm", image, "cat", "/etc/passwd"])}iceroot:x:${uid}:${gid}:iceroot:/tmp:/bin/bash\n`);
  writeFileSync(join(work, "group"), `${sh(["run", "--rm", image, "cat", "/etc/group"])}iceroot:x:${gid}:\n`);
  sh(
    [
      "run", "--rm", "--init",
      ...(network ? ["--network", "host"] : []),
      "--user", `${uid}:${gid}`,
      "-v", `${join(work, "passwd")}:/etc/passwd:ro`,
      "-v", `${join(work, "group")}:/etc/group:ro`,
      "-v", `${work}:/work`,
      "-v", `${cargoHome}:/cargo`,
      "-v", `${target}:/target`,
      "-e", "CARGO_HOME=/cargo",
      "-e", "CARGO_NET_OFFLINE=true",
      "-e", "CARGO_TARGET_DIR=/target",
      "-e", "HOME=/tmp",
      image, "bash", "-c", script,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
}

function result(log) {
  const path = join(work, log);
  const line = existsSync(path) ? readFileSync(path, "utf8").split("\n").find((text) => text.startsWith("RESULT ")) : undefined;
  return line === undefined ? { error: `no result in ${log}` } : JSON.parse(line.slice("RESULT ".length));
}

const vectors = JSON.parse(readFileSync(join(root, "test", "vectors", "wasm-native.json"), "utf8"));
const signatures = vectors.keys.reduce((sum, key) => sum + key.signatures.length, 0);
const transactions = vectors.transactions.cases.length;

/** The problems of a vector report: every check passed, with the expected counts. */
function vectorProblems(name, report, fixedAux) {
  if (report?.ok !== true || report.failures.length !== 0) {
    return [`${name}: ${JSON.stringify(report?.failures?.slice(0, 5) ?? report)}`];
  }
  const expected = {
    verifiedSignatures: signatures,
    fixedAuxSignatures: fixedAux ? signatures : 0,
    freshSignatures: signatures,
    verifiedTransactions: transactions,
    freshTransactions: transactions,
    fixedAuxTransactions: fixedAux ? transactions : 0,
    phraseAccounts: vectors.phraseAccounts.length,
    voteSelections: vectors.vote.selections.length,
    keystoresOpened: 1,
  };
  return Object.entries(expected)
    .filter(([key, value]) => report[key] !== value)
    .map(([key, value]) => `${name}: ${key} is ${report[key]}, not ${value}`);
}

await assemble();
fetchDependencies();
sh(["build", "-t", image, join(root, "test", "contexts", "tauri")], { stdio: ["ignore", "inherit", "inherit"] });

const problems = [];
if (values.e2e) {
  for (const name of ["ICEROOT_E2E_RELAY", "ICEROOT_E2E_WALLETS", "ICEROOT_E2E_MAX_HEIGHT", "ICEROOT_E2E_ARTIFACTS"]) {
    if (process.env[name] === undefined) {
      fail(`${name} is not set: run inside sdk-rust's tools/e2e/devnet.sh (see test/e2e/run.mjs)`);
    }
  }
  const funder = process.env.ICEROOT_E2E_FUNDER || "genesis-1";
  const wallets = JSON.parse(readFileSync(process.env.ICEROOT_E2E_WALLETS, "utf8"));
  const wallet = wallets.genesis.find((entry) => entry.label === funder);
  if (wallet === undefined) {
    fail(`the devnet has no genesis wallet ${funder}`);
  }
  const config = { mode: "e2e", relay: process.env.ICEROOT_E2E_RELAY, label: "tauri", funder: wallet.passphrase, maxHeight: Number(process.env.ICEROOT_E2E_MAX_HEIGHT) };
  runContainer(containerScript([{ name: "e2e", app: "app-published", config, seconds: 2400 }]), true);
  const report = result("e2e.log");
  if (report.scenario === undefined) {
    problems.push(`e2e: ${JSON.stringify(report)}`);
  } else {
    const scenario = report.scenario;
    console.log(`e2e: ${scenario.transactions.length} transactions forged, ${scenario.checks} checks, final height ${scenario.finalHeight}`);
    writeFileSync(join(process.env.ICEROOT_E2E_ARTIFACTS, "typescript-tauri.message.json"), `${JSON.stringify(scenario.message, null, 2)}\n`);
    writeFileSync(join(process.env.ICEROOT_E2E_ARTIFACTS, "typescript-tauri.transactions.json"), `${JSON.stringify(scenario.transactions, null, 2)}\n`);
  }
} else {
  const only = values.only === undefined ? undefined : values.only.split(",").map((name) => name.trim());
  runContainer(
    containerScript(
      [
        { name: "published", app: "app-published", config: { mode: "published" }, seconds: 900 },
        { name: "test", app: "app-test", config: { mode: "test", ...(only === undefined ? {} : { only }) }, seconds: 3600 },
      ],
      { examplePage: true },
    ),
    false,
  );
  if (!existsSync(join(example, "src-tauri", "Cargo.lock")) && existsSync(join(workExample, "src-tauri", "Cargo.lock"))) {
    cpSync(join(workExample, "src-tauri", "Cargo.lock"), join(example, "src-tauri", "Cargo.lock"));
  }
  const page = result("example.log");
  const published = result("published.log");
  const test = result("test.log");
  if (
    page.error !== undefined ||
    !/^[0-9a-f]{64}$/.test(page.network?.nethash ?? "") ||
    page.words !== 24 ||
    !/^d[1-9A-HJ-NP-Za-km-z]{33}$/.test(page.account?.address ?? "") ||
    page.account?.path !== "m/44'/1'/0'/0'/0'" ||
    page.signature?.verifies !== true
  ) {
    problems.push(`the example's own page: ${JSON.stringify(page)}`);
  } else {
    console.log(`example page: connected (height ${page.network.height}), kept a keystore, opened ${page.account.address} (balance ${page.account.balance}), signed a message that verifies`);
  }
  console.log(`webview: ${published.userAgent ?? test.userAgent}`);
  problems.push(...vectorProblems("published", published.vectors, false));
  if (!/^refused/.test(published.seam ?? "")) {
    problems.push(`the published plugin answered a test seam: ${published.seam}`);
  }
  if (published.refusedThroughEntry !== "SdkNotInitialized") {
    problems.push(`a command the plugin refuses did not read as SdkNotInitialized: ${published.refusedThroughEntry}`);
  }
  if (!Array.isArray(published.entrySeams) || published.entrySeams.length !== 0) {
    problems.push(`the published entry exports test seams: ${JSON.stringify(published.entrySeams)}`);
  }
  console.log(`published plugin: test seams ${published.seam?.split(",")[0]}`);
  problems.push(...vectorProblems("test", test.vectors, true));
  console.log(`published plugin ${published.version}: ${published.vectors?.checks} checks; test build: ${test.vectors?.checks} checks, ${test.vectors?.fixedAuxSignatures} signatures and ${test.vectors?.fixedAuxTransactions} transactions byte for byte`);
  const tests = test.tests ?? [];
  const bySuite = new Map();
  for (const each of tests) {
    const entry = bySuite.get(each.suite) ?? { passed: 0, failed: 0, skipped: 0, ms: 0 };
    entry[each.skipped !== undefined ? "skipped" : each.ok ? "passed" : "failed"] += 1;
    entry.ms += each.ms;
    bySuite.set(each.suite, entry);
    if (!each.ok) {
      problems.push(`${each.suite}: ${each.name}: ${each.error}`);
    }
  }
  for (const [suite, entry] of bySuite) {
    console.log(`suite ${suite}: ${entry.passed} passed, ${entry.failed} failed, ${entry.skipped} skipped (${Math.round(entry.ms / 1000)} s)`);
  }
  if (tests.length === 0) {
    problems.push(`test: ${JSON.stringify(test)}`);
  }
  console.log(`tests through the plugin: ${tests.filter((each) => each.ok && each.skipped === undefined).length} of ${tests.length} passed`);
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("tauri plugin check: passed");
