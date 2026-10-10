#!/usr/bin/env node
// Type-checks the sources, and an app's use of the published declarations, with TypeScript 7.0
// and 5.7. The consumer projects compile against dist/, so build first.
//
//   node scripts/check-types.mjs

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compilers = [
  ["TypeScript 7", join(root, "node_modules", "typescript", "bin", "tsc")],
  ["TypeScript 5.7", join(root, "node_modules", "typescript-5", "bin", "tsc")],
];
const projects = ["tsconfig.json", "test/types/tsconfig.json", "test/types/tsconfig.node.json"];

let failed = false;
for (const [name, compiler] of compilers) {
  for (const project of projects) {
    try {
      execFileSync(process.execPath, [compiler, "-p", project], { cwd: root, stdio: "inherit" });
      console.log(`check-types: ${name} ${project} ok`);
    } catch {
      console.error(`check-types: ${name} ${project} failed`);
      failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);
