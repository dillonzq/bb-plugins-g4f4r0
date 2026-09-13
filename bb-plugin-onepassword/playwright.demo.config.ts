import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/demo-e2e",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://localhost:43821",
    launchOptions: { executablePath: process.env.ONEPASSWORD_TEST_CHROME },
  },
  webServer: {
    command:
      "npm run build:service && node service/dist/demo.js http://localhost:43821 43821",
    url: "http://localhost:43821/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: "list",
});
