#!/usr/bin/env node
// Formatting and lints of the bindings: rustfmt, and clippy with warnings as errors for the native
// build (all targets, with and without the test seam) and the wasm32 build.
//
//   node scripts/check-rust.mjs

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { wasmCompilerEnv } from "./wasm-env.mjs";

const crate = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "wasm");
const env = { ...process.env, ...wasmCompilerEnv() };
const runs = [
  ["fmt", "--check"],
  ["clippy", "--locked", "--all-targets", "--", "-D", "warnings"],
  ["clippy", "--locked", "--all-targets", "--all-features", "--", "-D", "warnings"],
  ["clippy", "--locked", "--lib", "--target", "wasm32-unknown-unknown", "--", "-D", "warnings"],
  ["doc", "--locked", "--no-deps"],
];
for (const args of runs) {
  console.log(`check-rust: cargo ${args.join(" ")}`);
  execFileSync("cargo", args, {
    cwd: crate,
    env: args[0] === "doc" ? { ...env, RUSTDOCFLAGS: "-D warnings" } : env,
    stdio: "inherit",
  });
}
