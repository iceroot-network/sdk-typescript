// The browser build in Chromium under the page policy script-src 'self' 'wasm-unsafe-eval'.

import { expect, test, type Page } from "@playwright/test";

import { serve } from "./static-server.mjs";

const vectors = (await import("../vectors/wasm-native.json", { with: { type: "json" } })).default;
const transactions = vectors.transactions.cases.length;

const ROOT = new URL("../..", import.meta.url).pathname;
let server: { url: string; close: () => Promise<void> };

test.beforeAll(async () => {
  server = await serve(ROOT);
});

test.afterAll(async () => {
  await server.close();
});

async function report(page: Page, path: string): Promise<Record<string, unknown>> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${server.url}${path}`);
  const output = page.locator("#report[data-done]");
  await expect(output).toBeAttached();
  const text = await output.textContent();
  expect(errors).toEqual([]);
  return JSON.parse(text ?? "{}") as Record<string, unknown>;
}

const selections = vectors.vote.selections.length;

test("the published browser build matches native Rust", async ({ page }) => {
  const result = await report(page, "/test/contexts/chromium/index.html");
  expect(result["failures"]).toEqual([]);
  expect(result["ok"]).toBe(true);
  expect(result["voteSelections"]).toBe(selections);
  expect(result["keystoresOpened"]).toBe(1);
  expect(result["hasFixedAux"]).toBe(false);
  expect(result["verifiedSignatures"]).toBe(25);
  expect(result["verifiedTransactions"]).toBe(transactions);
  expect(result["freshTransactions"]).toBe(transactions);
  expect(result["fixedAuxTransactions"]).toBe(0);
});

test("the test browser build signs byte for byte as native Rust", async ({ page }) => {
  const result = await report(page, "/test/contexts/chromium/index.html?build=test");
  expect(result["failures"]).toEqual([]);
  expect(result["ok"]).toBe(true);
  expect(result["voteSelections"]).toBe(selections);
  expect(result["keystoresOpened"]).toBe(1);
  expect(result["fixedAuxSignatures"]).toBe(25);
  expect(result["fixedAuxTransactions"]).toBe(transactions);
});

test("without 'wasm-unsafe-eval' init() fails with WasmLoadFailed", async ({ page }) => {
  const result = await report(page, "/no-wasm-eval/test/contexts/chromium/index.html");
  expect(result["ok"]).toBe(false);
  expect(result["initError"]).toBe("WasmLoadFailed");
});
