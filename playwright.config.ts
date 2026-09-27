import { defineConfig } from "@playwright/test";

// The browser tests load the built package (dist/ and build/test/dist/): build both variants first.
export default defineConfig({
  testDir: "test/browser",
  timeout: 120_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
  },
});
