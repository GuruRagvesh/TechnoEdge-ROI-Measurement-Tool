import { defineConfig } from "@playwright/test";
import { testCredentials } from "./e2e/credentials.mjs";
const passwords = testCredentials();
process.env.E2E_ATTENDEE_PASSWORD = passwords.attendee;
process.env.E2E_HOST_PASSWORD = passwords.host;
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node e2e/start-server.mjs",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      APP_URL: "http://127.0.0.1:3100",
      STORAGE_ADAPTER: "local",
      LOCAL_STORAGE_PATH: ".test-work/e2e",
      MOCK_AUTH: "true",
      ASSESSMENT_MODE: "paired",
      LOCAL_TEST_ACCOUNTS: "true",
      TEST_ATTENDEE_PASSWORD: passwords.attendee,
      TEST_HOST_PASSWORD: passwords.host,
      IDENTITY_PEPPER: "automated-test-only-pepper",
      NEXT_DIST_DIR: ".next-e2e-app",
    },
  },
});
