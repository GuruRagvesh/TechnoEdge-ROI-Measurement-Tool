import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve("src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    environment: "node",
    // Existing suites cover the paired Base Camp/Summit flow; single-round.test.ts sets its own mode.
    env: { ASSESSMENT_MODE: "paired" },
  },
});
