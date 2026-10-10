#!/usr/bin/env node
// Checks that test/vectors/wasm-native.json is what native Rust produces today.
//
//   node scripts/check-vectors.mjs [--write]
//
// The file holds the native results that every JavaScript context must reproduce. It is
// regenerated from wasm/examples/vectors.rs; --write replaces it instead of comparing.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "test", "vectors", "wasm-native.json");

const generated = execFileSync(
  "cargo",
  ["run", "--quiet", "--locked", "--example", "vectors", "--features", "fixed-aux"],
  { cwd: join(root, "wasm"), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);

if (process.argv.includes("--write")) {
  writeFileSync(file, generated);
  console.log(`check-vectors: wrote ${file}`);
} else if (generated !== readFileSync(file, "utf8")) {
  console.error("check-vectors: test/vectors/wasm-native.json differs from native Rust; run with --write and review the change");
  process.exit(1);
} else {
  console.log("check-vectors: the vectors match native Rust");
}
