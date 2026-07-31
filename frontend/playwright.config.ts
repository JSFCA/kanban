import { defineConfig, devices } from "@playwright/test";

// Tests run against the real container: FastAPI serving the static export at /,
// not `next dev`. start.sh rebuilds the image, so a cold run takes a minute or two.
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://localhost:8000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "../scripts/start.sh",
    url: "http://localhost:8000/api/health",
    reuseExistingServer: true,
    timeout: 300_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
