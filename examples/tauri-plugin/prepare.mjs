#!/usr/bin/env node
// Copies the package's Tauri entry (dist/tauri, built by npm run build at the repository's root)
// into frontend/vendor, where the example's page imports it without a bundler.
//
//   node examples/tauri-plugin/prepare.mjs

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "..", "dist", "tauri");
if (!existsSync(join(dist, "index.js"))) {
  console.error("dist/tauri is missing: run npm run build at the repository's root first");
  process.exit(1);
}
const vendor = join(here, "frontend", "vendor", "iceroot-sdk", "tauri");
rmSync(vendor, { recursive: true, force: true });
cpSync(dist, vendor, { recursive: true });
console.log(`copied ${dist} to ${vendor}`);
