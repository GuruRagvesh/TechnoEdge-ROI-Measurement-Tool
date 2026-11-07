import { randomInt, randomUUID } from "node:crypto";
import { sendVerificationEmail } from "../src/lib/mail";
import { z } from "zod";
const raw = process.argv.find((s) => s.startsWith("--to="))?.slice(5);
if (!raw || !process.argv.includes("--confirm-send"))
  throw new Error(
    "Usage: npm run email:probe -- --to=YOUR_APPROVED_INBOX --confirm-send",
  );
await sendVerificationEmail(
  z.email().parse(raw),
  String(randomInt(100000, 1000000)),
  randomUUID(),
);
console.log(
  "Provider accepted the probe. Verify receipt in the approved inbox; API acceptance alone does not prove delivery. This probe grants no account session.",
);
