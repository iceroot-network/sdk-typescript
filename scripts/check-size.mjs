#!/usr/bin/env node
// Checks the size budget of the built package: the WebAssembly module at most 425 KiB (435,200
// bytes) gzipped.
//
//   node scripts/check-size.mjs [dist directory]
//
// Also checks that the three builds ship the same module, and prints the size of every file.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Maximum gzip size of the shared WebAssembly module, measured at compression level 9.
const BUDGET_GZIP_BYTES = 425 * 1024;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, process.argv[2] ?? "dist");

const modules = ["web/iceroot_sdk_bg.wasm", "node/iceroot_sdk_bg.wasm", "iife/iceroot-sdk_bg.wasm"];
let failed = false;

const reference = read(modules[0]);
for (const module of modules.slice(1)) {
  if (!read(module).equals(reference)) {
    console.error(`check-size: ${module} differs from ${modules[0]}`);
    failed = true;
  }
}

const gzipped = gzipSync(reference, { level: 9 }).length;
console.log(`module: ${reference.length} bytes, ${gzipped} bytes gzipped (budget ${BUDGET_GZIP_BYTES})`);
if (gzipped > BUDGET_GZIP_BYTES) {
  console.error(`check-size: the module is over budget by ${gzipped - BUDGET_GZIP_BYTES} bytes`);
  failed = true;
}

for (const file of list(dist)) {
  const bytes = readFileSync(join(dist, file));
  console.log(`${String(bytes.length).padStart(9)} ${String(gzipSync(bytes, { level: 9 }).length).padStart(9)}  ${file}`);
}

process.exit(failed ? 1 : 0);

function read(file) {
  return readFileSync(join(dist, file));
}

function list(dir) {
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
