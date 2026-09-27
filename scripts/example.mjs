#!/usr/bin/env node
// The example wallet in examples/vite-react-wallet, run against this repository's build:
//
//   node scripts/example.mjs build [--relay URL]   install the package, type-check and build it
//   node scripts/example.mjs dev [--relay URL]     install the package and start Vite's dev server
//
// The package is installed into the example the way an app gets it: packed with npm pack and
// extracted into its node_modules. The example's other dependencies (React, Vite, TypeScript)
// resolve from this repository's node_modules. Build the package first (npm run build). The relay
// is VITE_ICEROOT_RELAY, else the documented devnet at http://127.0.0.1:6003/api.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { installPackedPackage } from "../test/browser/install-package.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const EXAMPLE = join(ROOT, "examples", "vite-react-wallet");

/** Installs the packed package into the example and type-checks it with TypeScript 7 and 5.7. */
export function prepareExample() {
  if (!existsSync(join(ROOT, "dist", "web", "index.js"))) {
    throw new Error("dist/ is missing: run npm run build first");
  }
  installPackedPackage(EXAMPLE);
  for (const compiler of [join(ROOT, "node_modules", "typescript", "bin", "tsc"), join(ROOT, "node_modules", "typescript-5", "bin", "tsc")]) {
    for (const project of ["tsconfig.json", "tsconfig.node.json"]) {
      execFileSync(process.execPath, [compiler, "-p", join(EXAMPLE, project)], { stdio: "inherit" });
    }
  }
}

/** Builds the example for `relay` into examples/vite-react-wallet/dist. */
export async function buildExample(relay) {
  const { build } = await import("vite");
  process.env.VITE_ICEROOT_RELAY = relay;
  try {
    await build({ root: EXAMPLE, configFile: join(EXAMPLE, "vite.config.ts"), logLevel: "warn" });
  } finally {
    delete process.env.VITE_ICEROOT_RELAY;
  }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { relay: { type: "string" } } });
  const relay = values.relay ?? process.env.VITE_ICEROOT_RELAY ?? "http://127.0.0.1:6003/api";
  const [command] = positionals;
  if (command !== "build" && command !== "dev") {
    console.error("usage: node scripts/example.mjs build|dev [--relay URL]");
    process.exit(2);
  }
  prepareExample();
  if (command === "build") {
    await buildExample(relay);
    console.log(`example: built ${join(EXAMPLE, "dist")} for ${relay}`);
  } else {
    const { createServer } = await import("vite");
    process.env.VITE_ICEROOT_RELAY = relay;
    const server = await createServer({ root: EXAMPLE, configFile: join(EXAMPLE, "vite.config.ts"), server: { host: "127.0.0.1" } });
    await server.listen();
    server.printUrls();
  }
}
