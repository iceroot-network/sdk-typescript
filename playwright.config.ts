import { defineConfig } from "@playwright/test";

// The browser tests load the built package (dist/ and build/test/dist/): build both variants first.
// Run one project at a time (npm run test:browser, npm run test:webkit): both install the package
// into test/contexts/vite-react and build it there.
export default defineConfig({
  testDir: "test/browser",
  timeout: 120_000,
  fullyParallel: true,
  reporter: [["list"]],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "webkit",
      use: { browserName: "webkit" },
      // A page, and a Vite and React app. The Manifest V3 extension needs Chromium.
      testMatch: ["chromium.spec.ts", "vite-react.spec.ts"],
    },
  ],
  use: {
    headless: true,
  },
});
