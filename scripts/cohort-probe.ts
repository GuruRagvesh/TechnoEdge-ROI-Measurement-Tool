import { randomUUID } from "node:crypto";
import { LocalStorage, storage } from "../src/lib/storage";
import { runCohortProbe } from "./cohort-probe-lib";
import { infrastructureReadiness } from "../src/lib/readiness";
const graph = process.env.STORAGE_ADAPTER === "graph";
if (
  graph &&
  (!process.argv.includes("--confirm-live") ||
    !infrastructureReadiness().configurationReady)
)
  throw new Error(
    "Live synthetic probe requires approved configuration and --confirm-live; it writes only to the configured assessment root",
  );
const root = ".test-work/cohort-probe/" + randomUUID(),
  live = graph ? storage() : null;
console.log(
  JSON.stringify(
    await runCohortProbe(() => live || new LocalStorage(root), 20),
    null,
    2,
  ),
);
