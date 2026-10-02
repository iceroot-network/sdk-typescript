import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { serve } from "./static-server.mjs";

let server: { url: string; close: () => Promise<void> };
test.beforeAll(async () => { server = await serve(new URL("../..", import.meta.url).pathname); });
test.afterAll(async () => { await server.close(); });
test("all account link vectors through the Chromium public functions", async ({ page }) => {
  const records = readFileSync(new URL("../../../sdk-rust/vectors/sdk/S09-account-links.jsonl", import.meta.url), "utf8").trim().split("\n").map(line => JSON.parse(line));
  await page.goto(server.url + "/test/contexts/chromium/index.html");
  const count = await page.evaluate(async records => {
    const load = (path: string): Promise<any> => import(path);
    const sdk = await load("/build/test/dist/web/index.js");
    const glue = await load("/build/test/dist/web/iceroot_sdk.js");
    const checks = await load("/test/shared/link-checks.js");
    await sdk.init();
    const canonical = (v: any): string => JSON.stringify(v, (_key, value) => value && !Array.isArray(value) && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort()) : value);
    return checks.runLinks(sdk, glue, records, (actual: any, expected: any, name: string) => {
      if (canonical(actual) !== canonical(expected)) throw new Error(name + ": " + canonical(actual));
    });
  }, records);
  expect(count).toBe(113);
});

test("native account link records verify in Chromium", async ({ page }) => {
  const cases = JSON.parse(readFileSync(new URL("../vectors/wasm-native.json", import.meta.url), "utf8")).links;
  expect(cases).toHaveLength(3);
  await page.goto(server.url + "/test/contexts/chromium/index.html");
  const results = await page.evaluate(async cases => {
    const load = (path: string): Promise<any> => import(path);
    const sdk = await load("/dist/web/index.js");
    await sdk.init();
    const profile = sdk.profiles.devnet({ relays: ["https://node.example/api"] });
    return cases.map((item: any) => ({
      json: sdk.Link.toJson(sdk.Link.fromJson(item.json)),
      githubId: sdk.Link.verify(item.json, profile, {}, 1790512497000).githubId,
    }));
  }, cases);
  expect(results).toEqual(cases.map((item: any) => ({ json: item.json, githubId: item.githubId })));
});
