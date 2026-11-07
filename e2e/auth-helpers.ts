import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { Browser } from "@playwright/test";
export async function regularHostContext(browser: Browser) {
  const token = randomBytes(32).toString("base64url"),
    key = createHash("sha256").update(token).digest("hex");
  // Trusted integration-test setup only; no application endpoint can issue this identity.
  await mkdir(".test-work/e2e/auth/sessions", { recursive: true });
  await mkdir(".test-work/e2e/config", { recursive: true });
  await writeFile(
    ".test-work/e2e/config/host-allowlist.json",
    JSON.stringify({ emails: ["reviewer@example.test"] }),
  );
  await writeFile(
    `.test-work/e2e/auth/sessions/${key}.json`,
    JSON.stringify({
      identity: {
        id: "integration-host-" + Date.now(),
        name: "Quality Reviewer",
        email: "reviewer@example.test",
        role: "host",
      },
      expires: Date.now() + 3600000,
      revoked: false,
    }),
  );
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3100",
  });
  await context.addCookies([
    {
      name: "te_session",
      value: token,
      url: "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return context;
}
