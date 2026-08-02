import { defineConfig, devices } from "@playwright/test";

// Tests run against the real container: FastAPI serving the static export at /,
// not `next dev`. globalSetup starts it; see global-setup.ts for why that is not
// Playwright's `webServer` option.
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: "http://localhost:8000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
