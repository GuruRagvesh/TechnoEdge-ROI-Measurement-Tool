import { infrastructureReadiness } from "../src/lib/readiness";
import { GraphStorage } from "../src/lib/storage";
const report = infrastructureReadiness();
let siteReadVerified = false;
if (process.argv.includes("--live-readonly")) {
  if (!report.configurationReady)
    throw new Error(
      "Configure the approved staging environment before a live read-only check",
    );
  await new GraphStorage().verifyTarget();
  siteReadVerified = true;
}
console.log(
  JSON.stringify(
    {
      ...report,
      siteReadVerified,
      note: "No secrets or resource identifiers are printed. Read-only checks do not prove write concurrency, email delivery or pilot success.",
    },
    null,
    2,
  ),
);
if (process.argv.includes("--strict") && !report.configurationReady)
  process.exitCode = 2;
