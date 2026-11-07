import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
export function testCredentials() {
  const file = ".test-work/e2e-credentials.json";
  mkdirSync(".test-work", { recursive: true });
  if (!existsSync(file))
    writeFileSync(
      file,
      JSON.stringify({
        attendee: randomBytes(24).toString("base64url"),
        host: randomBytes(24).toString("base64url"),
      }),
      { flag: "wx", mode: 0o600 },
    );
  return JSON.parse(readFileSync(file, "utf8"));
}
