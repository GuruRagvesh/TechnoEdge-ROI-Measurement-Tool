import { spawn } from "node:child_process";
import { testCredentials } from "./credentials.mjs";
const passwords = testCredentials();
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      APP_URL: "http://127.0.0.1:3100",
      NODE_ENV: "development",
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
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));
