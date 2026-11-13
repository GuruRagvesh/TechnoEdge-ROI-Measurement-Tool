// Rollback helper for RECORD_STORE=postgres: copies every live record from
// PostgreSQL to SharePoint (same paths the SharePoint-only app uses), so the
// app can be switched back to RECORD_STORE=graph without losing in-progress
// work. Short-lived sign-in records (codes, limits) are skipped; sessions are
// copied so nobody is signed out by switching back.
// Usage: npm run records:to-sharepoint -- --confirm-live
import { PostgresRecords } from "../src/lib/record-store";
import { HybridStorage } from "../src/lib/storage";
if (!process.argv.includes("--confirm-live"))
  throw new Error("Copying records to SharePoint requires --confirm-live.");
const records = new PostgresRecords();
const target = new HybridStorage(records, undefined, undefined, false);
let copied = 0,
  skipped = 0;
for await (const { key, data } of records.all()) {
  if (
    key.startsWith("config/") ||
    (key.startsWith("auth/") && !key.startsWith("auth/sessions/"))
  ) {
    skipped++;
    continue;
  }
  await target.copyToSharePoint(key, data);
  if (++copied % 50 === 0) console.log(`copied ${copied}`);
}
console.log(JSON.stringify({ copied, skipped }));
await records.end();
