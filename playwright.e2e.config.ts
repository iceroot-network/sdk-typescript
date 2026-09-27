import { defineConfig } from "@playwright/test";

// The devnet end-to-end test in Chromium (test/e2e/chromium.e2e.ts). It needs a running devnet and
// both builds: run it with npm run test:e2e, which starts and stops the devnet.
export default defineConfig({
  testDir: "test/e2e",
  testMatch: "*.e2e.ts",
  timeout: 40 * 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
  },
});
