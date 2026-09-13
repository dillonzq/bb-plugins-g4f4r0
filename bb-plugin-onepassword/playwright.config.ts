import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  use: {
    baseURL: "http://localhost:43819",
    headless: true,
    launchOptions: { executablePath: process.env.ONEPASSWORD_TEST_CHROME },
  },
  webServer: {
    command:
      "npm run build:service && service/node_modules/.bin/tsx scripts/test-service.ts",
    url: "http://localhost:43819/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: "list",
});
