import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve("src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    environment: "node",
    // Existing suites cover the paired Base Camp/Summit flow; single-round.test.ts sets its own mode.
    // Tests must not inherit a deployment's settings (Vercel runs them during the build).
    env: {
      ASSESSMENT_MODE: "paired",
      ...Object.fromEntries(
        [
          "APP_URL",
          "STORAGE_ADAPTER",
          "LOCAL_STORAGE_PATH",
          "MOCK_AUTH",
          "LOCAL_TEST_ACCOUNTS",
          "IDENTITY_PEPPER",
          "GRAPH_TENANT_ID",
          "GRAPH_CLIENT_ID",
          "GRAPH_CLIENT_SECRET",
          "GRAPH_DRIVE_ID",
          "GRAPH_SITE_ID",
          "GRAPH_SITE_URL",
          "GRAPH_STORAGE_ROOT",
          "GRAPH_LAYOUT",
          "MAIL_PROVIDER",
          "RESEND_API_KEY",
          "EMAIL_FROM",
          "SMTP_HOST",
          "SMTP_USER",
          "SMTP_PASSWORD",
          "ERROR_MONITOR_URL",
          "ERROR_MONITOR_TOKEN",
          "EVIDENCE_MAX_MIB",
        ].map((k) => [k, ""]),
      ),
    },
  },
});
