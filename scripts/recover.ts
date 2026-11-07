import { AssessmentService } from "../src/lib/assessment";
import { getJson, mutate, storage } from "../src/lib/storage";
const roomId = process.argv.find((x) => x.startsWith("--room="))?.slice(7);
if (
  process.env.STORAGE_ADAPTER === "graph" &&
  !process.argv.includes("--confirm-live")
)
  throw new Error(
    "Live recovery requires administrator approval and --confirm-live.",
  );
if (!roomId || !/^[A-Za-z0-9_-]+$/.test(roomId))
  throw new Error("Usage: npm run recover -- --room=ROOM_ID");
const store = storage(),
  service = new AssessmentService(store),
  room = await service.room(roomId),
  owner = {
    id: room.ownerId,
    role: "host" as const,
    name: "Recovery operator",
    email: "",
  };
if (room.ownerId !== "default")
  await mutate<{ rooms: string[] }>(
    store,
    `hosts/${room.ownerId}/rooms.json`,
    (v) => ({ rooms: [...new Set([...(v?.rooms || []), roomId])] }),
  );
const people = await service.attendees(roomId, owner);
for (const p of people)
  await mutate<{ rooms: string[] }>(
    store,
    `attendees/${p.identity.id}/rooms.json`,
    (v) => ({ rooms: [...new Set([...(v?.rooms || []), roomId])] }),
  );
const referenced = new Set(
  people.flatMap((p) => p.evidence.map((e) => e.path)),
);
let orphaned = 0,
  missing = 0;
for (const key of await store.list(`rooms/${roomId}/upload-intents`)) {
  const intent = await getJson<{ path: string }>(store, key);
  if (intent && !referenced.has(intent.path) && (await store.read(intent.path)))
    orphaned++;
}
for (const key of referenced) if (!(await store.read(key))) missing++;
console.log(
  JSON.stringify(
    {
      roomId,
      indexesRecovered: people.length,
      deadlineSubmissions: people.filter(
        (p) => p.submissionReason === "deadline",
      ).length,
      unreferencedUploadIntents: orphaned,
      missingReferencedFiles: missing,
      note: "No evidence was deleted or linked retroactively. Review SharePoint versions/backups for missing data.",
    },
    null,
    2,
  ),
);
