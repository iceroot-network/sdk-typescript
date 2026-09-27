// The classic-script build in an unpacked Manifest V3 extension, in Chromium's persistent context:
// the wallet page fetches the module; the sandbox page (connect-src 'none' kept) and the service
// worker load it from the embedded bytes with initSync.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, expect, test } from "@playwright/test";

import { ROOT } from "./install-package.mjs";

const vectors = JSON.parse(readFileSync(join(ROOT, "test", "vectors", "wasm-native.json"), "utf8"));
const signatures = vectors.keys.reduce((sum: number, key: { signatures: unknown[] }) => sum + key.signatures.length, 0);

function assemble(build: string, policy: "documented" | "without-wasm-eval"): string {
  const dir = mkdtempSync(join(tmpdir(), "iceroot-sdk-mv3-"));
  cpSync(join(ROOT, "test", "contexts", "mv3-extension"), dir, { recursive: true });
  const vendor = join(dir, "vendor");
  mkdirSync(vendor);
  for (const file of ["iceroot-sdk.js", "iceroot-sdk_bg.wasm", "iceroot-sdk-bytes.js"]) {
    cpSync(join(ROOT, build, "iife", file), join(vendor, file));
  }
  cpSync(join(ROOT, "test", "shared", "vector-checks.js"), join(vendor, "vector-checks.js"));
  writeFileSync(join(vendor, "vectors.js"), `var IceRootVectors = ${JSON.stringify(vectors)};\n`);
  if (policy === "without-wasm-eval") {
    // The negative control: the same extension with 'wasm-unsafe-eval' removed from every policy.
    for (const file of ["manifest.json", "sandbox.html"]) {
      const path = join(dir, file);
      writeFileSync(path, readFileSync(path, "utf8").replaceAll(" 'wasm-unsafe-eval'", ""));
    }
  }
  return dir;
}

async function runExtension(extension: string) {
  const profile = mkdtempSync(join(tmpdir(), "iceroot-sdk-profile-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`chrome-extension://${id}/wallet.html`);
    const output = page.locator("#result[data-done]");
    await expect(output).toBeAttached({ timeout: 60_000 });
    expect(errors).toEqual([]);
    return JSON.parse((await output.textContent()) ?? "{}");
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
    rmSync(extension, { recursive: true, force: true });
  }
}

const CONTEXTS = ["walletPage", "sandbox", "serviceWorker"];

for (const [variant, build] of [
  ["published", "dist"],
  ["test", join("build", "test", "dist")],
] as const) {
  test(`the ${variant} classic-script build works in all three extension contexts`, async () => {
    const result = await runExtension(assemble(build, "documented"));
    for (const name of CONTEXTS) {
      const report = result[name];
      expect(report.failures, name).toEqual([]);
      expect(report.ok, name).toBe(true);
      expect(report.verifiedSignatures, name).toBe(signatures);
      expect(report.fixedAuxSignatures, name).toBe(variant === "test" ? signatures : 0);
    }
    // The sandbox keeps connect-src 'none': a request to the network is blocked by the policy.
    expect(result.sandbox.networkBlocked).toBe(true);
  });
}

test("without 'wasm-unsafe-eval' no extension context can load the module", async () => {
  const result = await runExtension(assemble("dist", "without-wasm-eval"));
  for (const name of CONTEXTS) {
    expect(result[name].ok, name).toBe(false);
    expect(result[name].loadError, name).toBe("WasmLoadFailed");
  }
});
