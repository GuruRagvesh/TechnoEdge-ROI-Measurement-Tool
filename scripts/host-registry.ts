import { storage, mutate } from "../src/lib/storage";
import { z } from "zod";
const [action, raw] = process.argv.slice(3);
if (!["add", "remove"].includes(action))
  throw new Error("Usage: npm run hosts -- add|remove email@company.com");
const email = z.email().parse(raw).trim().toLowerCase();
await mutate<{ emails: string[]; updatedAt: string }>(
  storage(),
  "config/host-allowlist.json",
  (old) => ({
    emails:
      action === "add"
        ? [...new Set([...(old?.emails || []), email])]
        : (old?.emails || []).filter((e) => e.trim().toLowerCase() !== email),
    updatedAt: new Date().toISOString(),
  }),
);
console.log(
  `Host registry updated (${action}). The next authenticated request uses the current registry.`,
);
