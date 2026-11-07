import { randomUUID } from "node:crypto";
import { Conflict, GraphStorage, storage } from "../src/lib/storage";
import { required } from "../src/lib/config";
if (
  process.env.STORAGE_ADAPTER === "graph" &&
  !process.argv.includes("--confirm-live")
)
  throw new Error(
    "Administrator approval required: add --confirm-live only for the approved dedicated assessment library/root.",
  );
const store = storage(),
  key = `probes/${randomUUID()}/record.json`;
const first = await store.write(key, Buffer.from('{"version":1}'), null);
const contenders = await Promise.allSettled([
  store.write(key, Buffer.from('{"version":2}'), first),
  store.write(key, Buffer.from('{"version":3}'), first),
]);
if (
  contenders.filter((x) => x.status === "fulfilled").length !== 1 ||
  contenders.filter(
    (x) => x.status === "rejected" && x.reason instanceof Conflict,
  ).length !== 1
)
  throw new Error("CAS race failed: do not deploy this storage adapter.");
if (store instanceof GraphStorage) {
  // Direct stale HTTP request: bypass adapter's metadata check to verify Microsoft enforces the precondition.
  const item = await store.request(await store.probeLocation(key));
  if (!item.ok) throw new Error("Unable to inspect probe");
  const metadata = await item.json();
  let conflict = false;
  try {
    await store.request(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(required("GRAPH_DRIVE_ID"))}/items/${metadata.id}/content`,
      {
        method: "PUT",
        headers: { "If-Match": first, "Content-Type": "application/json" },
        body: '{"version":999}',
      },
    );
  } catch (e) {
    if (e instanceof Conflict) conflict = true;
    else throw e;
  }
  if (!conflict)
    throw new Error("Graph did not enforce stale If-Match. Do not deploy.");
}
const result = await store.read(key);
if (!result || ![2, 3].includes(JSON.parse(result.data.toString()).version))
  throw new Error("Probe recovery failed");
let createConflict = false;
try {
  await store.write(key, Buffer.from("{}"), null);
} catch (e) {
  if (e instanceof Conflict) createConflict = true;
  else throw e;
}
if (!createConflict) throw new Error("Create-only protection failed");
console.log(
  `Storage probe passed: create-only, competing writes, stale preconditions and readback. Probe retained at ${key}.`,
);
