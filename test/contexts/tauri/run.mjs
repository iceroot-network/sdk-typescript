#!/usr/bin/env node
// The Tauri webview check on Linux: builds a Tauri 2 application whose page loads the SDK's
// browser build, and drives it with tauri-driver and WebKitWebDriver in a container, so the host
// needs no WebKitGTK development packages. Build both package variants first.
//
//   node test/contexts/tauri/run.mjs            (DOCKER="sudo docker" if docker needs it)
//
// Two runs: the documented policy with 'wasm-unsafe-eval', where the published and the test builds
// must match the native vectors and the published build must connect to a relay through the HTTP
// plugin's fetch (the relay answers from sdk-rust's recorded devnet answers, from the sdk-rust
// checkout next to this repository or SDK_RUST_DIR); and the same policy without it, where loading
// must fail.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const work = join(root, "build", "tauri-check");
const image = "iceroot-sdk-tauri-check:1";
const docker = (process.env.DOCKER ?? "docker").split(" ");
const vectors = JSON.parse(readFileSync(join(root, "test", "vectors", "wasm-native.json"), "utf8"));
const signatures = vectors.keys.reduce((sum, key) => sum + key.signatures.length, 0);
const transactions = vectors.transactions.cases.length;

function sh(args, options = {}) {
  const [command, ...rest] = [...docker, ...args];
  return execFileSync(command, rest, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
}

// A 32 by 32 RGBA PNG for the window icon, which Tauri requires.
function icon() {
  const size = 32;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      raw.set([0x2f, 0x6f, 0xa7, 0xff], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function assemble() {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  for (const entry of ["frontend", "src-tauri", "smoke.mjs", "relay.mjs"]) {
    cpSync(join(here, entry), join(work, entry), { recursive: true });
  }
  const sdkRust = resolve(process.env.SDK_RUST_DIR ?? join(root, "..", "sdk-rust"));
  cpSync(join(sdkRust, "crates", "iceroot-sdk-api", "tests", "fixtures", "devnet"), join(work, "fixtures"), { recursive: true });
  const vendor = join(work, "frontend", "vendor");
  cpSync(join(root, "dist", "web"), join(vendor, "sdk"), { recursive: true });
  cpSync(join(root, "build", "test", "dist", "web"), join(vendor, "sdk-test"), { recursive: true });
  cpSync(join(root, "test", "shared", "vector-checks.js"), join(vendor, "vector-checks.js"));
  writeFileSync(join(vendor, "vectors.js"), `var IceRootVectors = ${JSON.stringify(vectors)};\n`);
  mkdirSync(join(work, "src-tauri", "icons"));
  writeFileSync(join(work, "src-tauri", "icons", "icon.png"), icon());
}

function runInContainer() {
  const locked = existsSync(join(here, "src-tauri", "Cargo.lock")) ? "--locked" : "";
  const script = [
    "set -e",
    "cd /work/src-tauri",
    `cargo build --release ${locked}`,
    "node /work/relay.mjs /work/fixtures 6003 &",
    "dbus-run-session -- xvfb-run -a node /work/smoke.mjs /target/release/iceroot-sdk-tauri-check | tee /work/documented.log || true",
    // The negative control: the same application without 'wasm-unsafe-eval' in its policy.
    "sed -i \"s/ 'wasm-unsafe-eval'//\" tauri.conf.json",
    `cargo build --release ${locked}`,
    "dbus-run-session -- xvfb-run -a node /work/smoke.mjs /target/release/iceroot-sdk-tauri-check | tee /work/without-wasm-eval.log || true",
    `chown -R ${process.getuid()}:${process.getgid()} /work`,
  ].join("\n");
  sh(
    [
      "run", "--rm", "--init",
      "-v", `${work}:/work`,
      "-v", "iceroot-sdk-tauri-cargo:/usr/local/cargo/registry",
      "-v", "iceroot-sdk-tauri-target:/target",
      "-e", "CARGO_TARGET_DIR=/target",
      image, "bash", "-c", script,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
}

function result(log) {
  const line = readFileSync(join(work, log), "utf8").split("\n").find((text) => text.startsWith("RESULT "));
  return line === undefined ? { error: `no result in ${log}` } : JSON.parse(line.slice("RESULT ".length));
}

assemble();
sh(["build", "-t", image, here], { stdio: ["ignore", "inherit", "inherit"] });
runInContainer();
if (!existsSync(join(here, "src-tauri", "Cargo.lock"))) {
  cpSync(join(work, "src-tauri", "Cargo.lock"), join(here, "src-tauri", "Cargo.lock"));
}

const documented = result("documented.log");
const withoutWasmEval = result("without-wasm-eval.log");
const problems = [];
for (const [name, fixedAux] of [["published", 0], ["test", signatures]]) {
  const report = documented[name];
  if (report?.ok !== true || report.failures.length !== 0) {
    problems.push(`${name}: ${JSON.stringify(report ?? documented)}`);
  } else if (
    report.verifiedSignatures !== signatures ||
    report.fixedAuxSignatures !== fixedAux ||
    report.verifiedTransactions !== transactions ||
    report.freshTransactions !== transactions ||
    report.fixedAuxTransactions !== (fixedAux === 0 ? 0 : transactions)
  ) {
    problems.push(`${name}: unexpected counts ${JSON.stringify(report)}`);
  }
  if (withoutWasmEval[name]?.loadError !== "WasmLoadFailed") {
    problems.push(`${name} without 'wasm-unsafe-eval': ${JSON.stringify(withoutWasmEval[name] ?? withoutWasmEval)}`);
  }
}
console.log(`webview: ${documented.userAgent}`);
console.log(
  `published build: ${documented.published?.checks} checks; test build: ${documented.test?.checks} checks, ` +
    `${documented.test?.fixedAuxSignatures} signatures and ${documented.test?.fixedAuxTransactions} transactions byte for byte`,
);
const transport = documented.transport;
if (
  transport?.ok !== true ||
  transport.webviewFetch !== "refused" ||
  !(transport.validators > 0) ||
  !/^[0-9a-f]{64}$/.test(transport.nethash ?? "") ||
  !/^[1-9][0-9]*$/.test(transport.balance ?? "")
) {
  problems.push(`transport: ${JSON.stringify(transport ?? documented)}`);
}
if (withoutWasmEval.transport?.error !== "WasmLoadFailed") {
  problems.push(`transport without 'wasm-unsafe-eval': ${JSON.stringify(withoutWasmEval.transport ?? withoutWasmEval)}`);
}
console.log(
  `transport: the HTTP plugin's fetch read ${transport?.validators} validators and a balance of ${transport?.balance} at height ${transport?.height}; the webview's own fetch was ${transport?.webviewFetch}`,
);
console.log(`without 'wasm-unsafe-eval': ${withoutWasmEval.published?.loadError}, ${withoutWasmEval.test?.loadError}`);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("tauri check: passed");
