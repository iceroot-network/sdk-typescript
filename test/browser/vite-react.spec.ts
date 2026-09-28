// The package installed from its tarball into a Vite and React page: the production
// build under the page policy script-src 'self' 'wasm-unsafe-eval', and the development server.

import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { build, createServer, preview } from "vite";

import { installPackedPackage, ROOT } from "./install-package.mjs";

const CONTEXT = join(ROOT, "test", "contexts", "vite-react");
const vectors = (await import("../vectors/wasm-native.json", { with: { type: "json" } })).default;
const probe = vectors.keys[0];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  installPackedPackage(CONTEXT);
  await build({ root: CONTEXT, logLevel: "warn" });
});

async function exercise(page: Page, url: string) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(url);
  const report = page.locator("#report");
  await expect(report).toHaveAttribute("data-ok", "true");
  const parsed = JSON.parse((await report.textContent()) ?? "{}");
  expect(parsed.failures).toEqual([]);
  expect(parsed.verifiedSignatures).toBe(25);
  expect(parsed.verifiedTransactions).toBe(vectors.transactions.cases.length);

  await page.fill("#passphrase", probe.passphrase);
  await page.click("#import");
  await expect(page.locator("#address")).toHaveText(probe.addresses["90"]);
  await page.fill("#message", "IceRoot sign-in test");
  await page.click("#sign");
  await expect(page.locator("#verified")).toHaveText("verified");
  await expect(page.locator("#signature")).toHaveText(/^[0-9a-f]{128}$/);
  expect(errors).toEqual([]);
}

test("the production build works under the page policy", async ({ page }) => {
  const server = await preview({ root: CONTEXT, logLevel: "warn", preview: { host: "127.0.0.1", port: 0 } });
  try {
    const url = server.resolvedUrls?.local[0];
    expect(url).toBeDefined();
    const html = await (await fetch(url ?? "")).text();
    expect(html).toMatch(/Content-Security-Policy" content="[^"]*script-src &#39;self&#39; &#39;wasm-unsafe-eval&#39;/);
    await exercise(page, url ?? "");
  } finally {
    await server.close();
  }
});

test("the development server works with the SDK excluded from pre-bundling", async ({ page }) => {
  const server = await createServer({ root: CONTEXT, logLevel: "warn", server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  try {
    await exercise(page, server.resolvedUrls?.local[0] ?? "");
  } finally {
    await server.close();
  }
});
