import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  use: { baseURL: "http://127.0.0.1:3002", trace: "retain-on-failure" },
  webServer: { command: "pnpm exec next dev --port 3002", url: "http://127.0.0.1:3002", reuseExistingServer: true },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } }
  ]
});
