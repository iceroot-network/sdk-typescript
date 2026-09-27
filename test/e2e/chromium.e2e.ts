// The devnet end-to-end scenario in Chromium (page.js), through the browser build. Run by run.mjs
// against a devnet the harness started; see scenario.js for what it checks.

import { expect, test } from "@playwright/test";

import { serve } from "../browser/static-server.mjs";
import { e2eEnvironment, writeArtifacts } from "./environment.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;

test("the devnet scenario in Chromium", async ({ page }) => {
  test.setTimeout(40 * 60_000);
  const environment = e2eEnvironment("genesis-2");
  const server = await serve(ROOT, { connect: [new URL(environment.relay).origin] });
  try {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => console.log(`chromium: ${message.text()}`));
    const query = new URLSearchParams({
      relay: environment.relay,
      funder: environment.funderPassphrase,
      label: "web",
      maxHeight: String(environment.maxHeight),
    });
    await page.goto(`${server.url}/test/e2e/page.html?${query}`);
    const output = page.locator("#report[data-done]");
    await expect(output).toBeAttached({ timeout: 39 * 60_000 });
    const report = JSON.parse((await output.textContent()) ?? "{}");
    expect(report.error).toBeUndefined();
    expect(report.workerReachedNetwork).toBe(false);
    expect(errors).toEqual([]);
    writeArtifacts(environment.artifacts, report);
  } finally {
    await server.close();
  }
});
