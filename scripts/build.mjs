#!/usr/bin/env node
// Builds the package from the Rust bindings in wasm/ and the TypeScript wrapper in src/.
//
//   node scripts/build.mjs [--variant release|test] [--pack]
//
// Steps: compile the bindings for wasm32-unknown-unknown; run wasm-bindgen for the web, Node and
// classic-script targets; optimize the module once with wasm-opt -Oz (the three targets share one
// .wasm); bundle the wrapper for each target with esbuild; emit the type declarations; write the
// embedded-bytes file for contexts that cannot fetch the module; write SHA256SUMS.
//
// The compile uses its own compiler flags (rustFlags below) and ignores RUSTFLAGS, so that every
// builder compiles the module the same way.
//
// The release variant writes dist/, which is what the package ships. The test variant writes
// build/test/dist/ with the test seams compiled in (reproducible signatures, and the keystore
// vectors' salts, nonces and lowered parameter floor), for the cross-checks against native Rust
// and the vectors only; it is never packed. --pack also writes the package tarball and its checksums
// to build/pack/.
//
// Builders need Rust with the wasm32-unknown-unknown target, the wasm-bindgen CLI at the exact
// version of the crate in wasm/Cargo.lock, and clang with the wasm32 target for libsecp256k1
// (set CC_wasm32_unknown_unknown and AR_wasm32_unknown_unknown to choose them). Consumers of the
// package need none of these.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import vm from "node:vm";

import * as esbuild from "esbuild";

import { wasmCompilerEnv } from "./wasm-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: options } = parseArgs({
  options: {
    variant: { type: "string", default: "release" },
    pack: { type: "boolean", default: false },
  },
});
const variant = options.variant;
if (variant !== "release" && variant !== "test") {
  fail(`unknown variant ${variant}: use release or test`);
}
if (options.pack && variant !== "release") {
  fail("only the release variant is packed");
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const outDir = join(root, variant === "release" ? "dist" : "build/test/dist");
const wasmDir = join(root, "build", variant, "wasm");
const crateDir = join(root, "wasm");
const targetDir = join(crateDir, "target", variant === "release" ? "release-build" : "test-build");
const OUT_NAME = "iceroot_sdk";
const IIFE_NAME = "iceroot-sdk";
const IIFE_GLOBAL = "IceRootSdk";
const BYTES_GLOBAL = "IceRootSdkWasmBytes";
// Exports of the test seams, which the test module must have and the release module must not.
const TEST_SEAMS = ["signMessageWithAux", "keystoreEncryptWithSaltAndNonce", "signProofWithAux"];

// The features rustc enables by default for wasm32-unknown-unknown. wasm-bindgen drops the
// target_features section, so wasm-opt is told the same set explicitly and never adds others.
const WASM_FEATURES = [
  "--enable-bulk-memory",
  "--enable-bulk-memory-opt",
  "--enable-multivalue",
  "--enable-mutable-globals",
  "--enable-nontrapping-float-to-int",
  "--enable-reference-types",
  "--enable-sign-ext",
];

async function main() {
  const tools = findTools();
  step(`building the ${variant} variant`);

  const wasm = compileBindings(tools);
  runWasmBindgen(tools, wasm);
  const optimized = optimize(tools);
  checkTestSeam();

  rmSync(outDir, { recursive: true, force: true });
  await bundle("web", optimized);
  await bundle("node", optimized);
  await bundleClassicScript(optimized);
  writeEmbeddedBytes(optimized);
  if (variant === "release") {
    emitDeclarations();
  }
  writeChecksums(outDir, listFiles(outDir), join(outDir, "SHA256SUMS"));
  report(optimized);

  if (options.pack) {
    pack();
  }
}

// Tools --------------------------------------------------------------------------------------

function findTools() {
  const lock = readFileSync(join(crateDir, "Cargo.lock"), "utf8");
  const locked = /\[\[package\]\]\nname = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
  if (locked === undefined) {
    fail("wasm/Cargo.lock has no wasm-bindgen package");
  }
  const bindgen = process.env.WASM_BINDGEN ?? "wasm-bindgen";
  let bindgenVersion;
  try {
    bindgenVersion = output(bindgen, ["--version"]).trim().split(/\s+/)[1];
  } catch {
    bindgenVersion = undefined;
  }
  if (bindgenVersion !== locked) {
    fail(
      `wasm-bindgen ${bindgenVersion ?? "(not found)"} does not match the crate's ${locked}: ` +
        `cargo install wasm-bindgen-cli --version ${locked} --locked`,
    );
  }

  let compilerEnv;
  try {
    compilerEnv = wasmCompilerEnv();
  } catch (error) {
    fail(error.message);
  }

  const wasmOpt = join(root, "node_modules", ".bin", "wasm-opt");
  if (!existsSync(wasmOpt)) {
    fail("wasm-opt is missing: run npm install");
  }
  return { bindgen, compilerEnv, wasmOpt };
}

// Rust and wasm-bindgen ----------------------------------------------------------------------

// The compiler flags of the WebAssembly compile:
// - sha2's compact backend: the fully unrolled SHA-256 and SHA-512 rounds cost about 16 KB of
//   module, and the one heavy use, a recovery phrase's PBKDF2, stays well under a second;
// - fixed names for the directories the sources come from (the Cargo home with the registry and
//   the git checkout of heartwood-core, sdk-rust next to this repository, and this repository), so
//   that the module's panic locations name no directory of the machine that built it.
// Two builds give the same bytes when they also use the same checkout paths: sdk-rust is a path
// dependency outside this workspace, and Cargo hashes its absolute path into the crates' symbols.
function rustFlags() {
  const remaps = new Map();
  const remap = (path, name) => {
    remaps.set(resolve(path), name);
    if (existsSync(path)) {
      remaps.set(realpathSync(path), name);
    }
  };
  remap(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "/cargo");
  remap(join(root, "..", "sdk-rust"), "/sdk-rust");
  remap(root, "/sdk-typescript");
  return [
    "--cfg",
    'sha2_backend_soft="compact"',
    ...[...remaps].map(([path, name]) => `--remap-path-prefix=${path}=${name}`),
  ];
}

function compileBindings(tools) {
  step("compiling the bindings for wasm32-unknown-unknown");
  const args = [
    "build",
    "--release",
    "--lib",
    "--locked",
    "--target",
    "wasm32-unknown-unknown",
    "--target-dir",
    targetDir,
  ];
  if (variant === "test") {
    args.push("--features", "fixed-aux,keystore-testing");
  }
  const env = { ...process.env, ...tools.compilerEnv, CARGO_ENCODED_RUSTFLAGS: rustFlags().join("\x1f") };
  delete env.RUSTFLAGS;
  run("cargo", args, { cwd: crateDir, env });
  return join(targetDir, "wasm32-unknown-unknown", "release", "iceroot_sdk_wasm.wasm");
}

const GLUE_TARGETS = [
  { name: "web", target: "web" },
  { name: "node", target: "experimental-nodejs-module" },
  { name: "iife", target: "no-modules" },
];

function runWasmBindgen(tools, wasm) {
  step("generating the JavaScript glue");
  rmSync(wasmDir, { recursive: true, force: true });
  for (const { name, target } of GLUE_TARGETS) {
    run(tools.bindgen, ["--target", target, "--out-dir", join(wasmDir, name), "--out-name", OUT_NAME, wasm]);
  }
  const first = readFileSync(join(wasmDir, "web", `${OUT_NAME}_bg.wasm`));
  for (const { name } of GLUE_TARGETS) {
    if (!first.equals(readFileSync(join(wasmDir, name, `${OUT_NAME}_bg.wasm`)))) {
      fail(`wasm-bindgen produced a different module for the ${name} target`);
    }
  }
}

function optimize(tools) {
  step("optimizing the module with wasm-opt -Oz");
  const input = join(wasmDir, "web", `${OUT_NAME}_bg.wasm`);
  const optimized = join(wasmDir, `${OUT_NAME}_bg.opt.wasm`);
  // --converge repeats the passes while the module still shrinks.
  run(tools.wasmOpt, ["-Oz", "--converge", ...WASM_FEATURES, input, "-o", optimized]);
  return optimized;
}

function checkTestSeam() {
  const glue = readFileSync(join(wasmDir, "web", `${OUT_NAME}.js`), "utf8");
  for (const seam of TEST_SEAMS) {
    const present = glue.includes(seam);
    if (variant === "release" && present) {
      fail(`the release module exports the test seam ${seam}`);
    }
    if (variant === "test" && !present) {
      fail(`the test module lacks the test seam ${seam}`);
    }
  }
}

// Bundles ------------------------------------------------------------------------------------

function entryPoints() {
  return {
    index: join(root, "src", variant === "release" ? "index.ts" : "testing.ts"),
    vote: join(root, "src", "vote.ts"),
    keystore: join(root, "src", "keystore.ts"),
    ownership: join(root, "src", "ownership.ts"),
  };
}

// The classic-script build has one entry: the root with the vote library, the keystore and the
// ownership proofs as namespaces (the test entry carries them too).
function classicScriptEntry() {
  return join(root, "src", variant === "release" ? "iife.ts" : "testing.ts");
}

// Resolves the loader and the glue of one target. The glue stays a separate file next to the
// bundle, unchanged from wasm-bindgen, so bundlers see the usual new URL(..., import.meta.url).
function targetPlugin(target) {
  return {
    name: `iceroot-${target}`,
    setup(build) {
      build.onResolve({ filter: /^#glue\/(web|node)$/ }, () => ({
        path: `./${OUT_NAME}.js`,
        external: true,
      }));
      build.onResolve({ filter: /\/internal\/loader\.js$/ }, (args) => ({
        path: join(
          dirname(args.importer),
          "internal",
          target === "web" ? "loader.ts" : `loader-${target}.ts`,
        ),
      }));
    },
  };
}

function common() {
  return {
    bundle: true,
    target: "es2022",
    legalComments: "inline",
    logLevel: "warning",
    define: { __ICEROOT_SDK_VERSION__: JSON.stringify(pkg.version) },
    banner: { js: `/*! ${pkg.name} ${pkg.version} | ${pkg.license} */` },
  };
}

async function bundle(target, optimized) {
  step(`bundling the ${target} build`);
  const dir = join(outDir, target);
  await esbuild.build({
    ...common(),
    entryPoints: entryPoints(),
    outdir: dir,
    format: "esm",
    platform: target === "node" ? "node" : "neutral",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    plugins: [targetPlugin(target)],
  });
  cpSync(join(wasmDir, target, `${OUT_NAME}.js`), join(dir, `${OUT_NAME}.js`));
  cpSync(optimized, join(dir, `${OUT_NAME}_bg.wasm`));
}

async function bundleClassicScript(optimized) {
  step("bundling the classic-script build");
  const dir = join(outDir, "iife");
  const result = await esbuild.build({
    ...common(),
    banner: {},
    entryPoints: [classicScriptEntry()],
    write: false,
    format: "iife",
    globalName: "__icerootSdk",
    platform: "browser",
    plugins: [targetPlugin("iife")],
  });
  const wrapper = result.outputFiles[0]?.text;
  if (wrapper === undefined) {
    fail("esbuild wrote no classic-script bundle");
  }
  // wasm-bindgen's classic-script glue defines `wasm_bindgen` in the same function scope as the
  // wrapper, so the build adds exactly one global, IceRootSdk.
  const glue = readFileSync(join(wasmDir, "iife", `${OUT_NAME}.js`), "utf8");
  const script = [
    `/*! ${pkg.name} ${pkg.version} | ${pkg.license} | classic-script build */`,
    `var ${IIFE_GLOBAL} = (function () {`,
    glue,
    wrapper,
    "return __icerootSdk;",
    "})();",
    "",
  ].join("\n");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${IIFE_NAME}.js`), script);
  // The glue fetches the module named after the script when init() gets no source.
  cpSync(optimized, join(dir, `${IIFE_NAME}_bg.wasm`));
}

// The module as a classic script that defines one global, for the Manifest V3 sandbox page (whose
// connect-src 'none' blocks fetching it) and service worker: initSync(IceRootSdkWasmBytes).
function writeEmbeddedBytes(optimized) {
  step("writing the embedded-bytes file");
  const bytes = readFileSync(optimized);
  const digest = sha256(bytes);
  const script = [
    `/*! ${pkg.name} ${pkg.version} | ${pkg.license} | WebAssembly module ${bytes.length} bytes, SHA-256 ${digest} */`,
    `var ${BYTES_GLOBAL} = (function (text) {`,
    "  var binary = atob(text);",
    "  var bytes = new Uint8Array(binary.length);",
    "  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);",
    "  return bytes;",
    `})("${bytes.toString("base64")}");`,
    "",
  ].join("\n");
  const file = join(outDir, "iife", `${IIFE_NAME}-bytes.js`);
  writeFileSync(file, script);

  // The file must decode to exactly the module.
  const context = vm.createContext({ atob, Uint8Array });
  vm.runInContext(script, context);
  const decoded = Buffer.from(vm.runInContext(BYTES_GLOBAL, context));
  if (!decoded.equals(bytes)) {
    fail("the embedded-bytes file does not decode to the module");
  }
}

function emitDeclarations() {
  step("emitting type declarations");
  const types = join(root, "build", "types");
  rmSync(types, { recursive: true, force: true });
  run(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"], {
    cwd: root,
  });
  // Ship the declarations reachable from the entry points, and check that none of them refers to
  // the glue, whose types are internal.
  const reachable = new Set();
  const visit = (file) => {
    if (reachable.has(file)) {
      return;
    }
    reachable.add(file);
    const text = readFileSync(join(types, file), "utf8");
    if (text.includes("#glue") || text.includes("build/")) {
      fail(`the declaration ${file} refers to build internals`);
    }
    for (const match of text.matchAll(/(?:from|import\()\s*"(\.{1,2}\/[^"]+)\.js"/g)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        visit(relative(types, join(types, dirname(file), `${specifier}.d.ts`)));
      }
    }
  };
  visit("index.d.ts");
  visit("vote.d.ts");
  visit("keystore.d.ts");
  visit("ownership.d.ts");
  for (const file of reachable) {
    mkdirSync(dirname(join(outDir, "web", file)), { recursive: true });
    cpSync(join(types, file), join(outDir, "web", file));
  }
}

// Checksums and packing ----------------------------------------------------------------------

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function listFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        files.push(relative(dir, path));
      }
    }
  };
  walk(dir);
  return files;
}

function writeChecksums(dir, files, destination) {
  const lines = files
    .filter((file) => join(dir, file) !== destination)
    .map((file) => `${sha256(readFileSync(join(dir, file)))}  ${file.split("\\").join("/")}`);
  writeFileSync(destination, `${lines.join("\n")}\n`);
}

function pack() {
  step("packing the tarball");
  const packDir = join(root, "build", "pack");
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  const result = JSON.parse(output("npm", ["pack", "--json", "--pack-destination", packDir], { cwd: root }));
  const tarball = result[0]?.filename;
  if (tarball === undefined) {
    fail("npm pack wrote no tarball");
  }
  // The release assets: the tarball, and the module and embedded-bytes file on their own for hosts
  // that serve them separately. Their checksums go next to them.
  cpSync(join(outDir, "web", `${OUT_NAME}_bg.wasm`), join(packDir, `${OUT_NAME}_bg.wasm`));
  cpSync(join(outDir, "iife", `${IIFE_NAME}-bytes.js`), join(packDir, `${IIFE_NAME}-bytes.js`));
  writeChecksums(packDir, listFiles(packDir), join(packDir, "SHA256SUMS"));
  step(`packed ${tarball}`);
  process.stdout.write(readFileSync(join(packDir, "SHA256SUMS"), "utf8"));
}

// Output -------------------------------------------------------------------------------------

function report(optimized) {
  const raw = statSync(optimized).size;
  step(`done: ${relative(root, outDir)} (module ${raw} bytes)`);
}

function step(message) {
  process.stdout.write(`build: ${message}\n`);
}

function run(command, args, extra = {}) {
  execFileSync(command, args, { stdio: "inherit", ...extra });
}

function output(command, args, extra = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...extra });
}

function fail(message) {
  process.stderr.write(`build: ${message}\n`);
  process.exit(1);
}

await main();
