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

// 416 KiB, the budget from the ownership proofs on; the release with the post-quantum signer has
// 450 KiB. The module without the vote library, the keystore and the proofs measured 321,041 bytes
// gzipped against 330 KiB: keys, addresses, transactions and the node API client's mapping
// (requests and answers are built and read in Rust, so every language shares one mapping). The
// vote library adds about 43 KB gzipped (the four modes, the check and the plain English reasons
// of every pick), the keystore about 44 KB (Argon2id, XChaCha20-Poly1305, base64url and the
// format): 408,000 bytes against the earlier budget of 400 KiB. The keystore normalizes passwords
// with the same ICU4X normalizer and data as recovery phrases; with a second normalizer's tables
// the module measured 460 KB. The ownership proofs of Solar addresses add about 7.6 KB (the
// message format and its checks, Bech32m accounts, the issue time's calendar and the proof's
// JSON; they reuse the module's signing): 415,604 bytes. They move to a separate legacy package,
// with the Solar-compatible formats, once IceRoot's own formats replace those. The budget was
// 416 KiB until the core escaped a node's text as every host does (the Unicode format characters,
// separators and spaces), wrote runs of spaces in the vote reasons as escapes and judged a
// serialized draft's floor at the network's height: about 1 KB, 426,224 bytes. It was 417 KiB
// until the account links: the core's refusal of link text in plain message signing (427,515
// bytes), then building, checking and signing links and revocations and reading their records
// and history, about 7 KB: 434,577 bytes.
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
