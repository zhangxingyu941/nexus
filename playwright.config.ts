import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "test-results",
  reporter: [["line"]],
  retries: 0,
  testDir: "./e2e",
  timeout: 90_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  workers: 1,
});
