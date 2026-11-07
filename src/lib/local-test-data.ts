import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph } from "docx";
import { AssessmentService, roomKey, participantKey } from "./assessment";
import { answerKey, mark } from "./challenges";
import { createJson, getJson, mutate, type Storage } from "./storage";
import { assertLocalTestEnabled, LocalTestStorage } from "./local-test-storage";
import { excelReport } from "./reports";
import {
  iso,
  TASK_IDS,
  type Identity,
  type Participant,
  type Room,
  type TaskId,
} from "./types";
export const testHost: Identity = {
  id: "HOST001",
  name: "Priya Sharma",
  email: "priya.sharma@technoedge.test",
  role: "host",
  testAccount: true,
};
export const testAttendee: Identity = {
  id: "DEMO001",
  name: "Arjun Mehta",
  email: "arjun.mehta@technoedge.test",
  role: "attendee",
  testAccount: true,
};
const cache = new Map<string, Promise<void>>();
const standard: TaskId[] = ["inbox", "tables", "clean"];
const roomDefinitions: Room[] = [
  {
    id: "baseline-pre",
    name: "AI Productivity Benchmark · Base Camp",
    phase: "pre",
    durationMinutes: 60,
    batch: "Operations · November 2026",
    ownerId: "HOST001",
    closed: false,
    createdAt: iso(),
    dataClassification: "synthetic-test",
  },
  {
    id: "baseline-post",
    name: "AI Productivity Benchmark · Summit",
    phase: "post",
    preRoomId: "baseline-pre",
    durationMinutes: 60,
    batch: "Operations · November 2026",
    ownerId: "HOST001",
    closed: false,
    createdAt: iso(),
    dataClassification: "synthetic-test",
  },
  {
    id: "sales-pre",
    name: "Sales Excellence · Base Camp",
    phase: "pre",
    durationMinutes: 60,
    batch: "Sales · November 2026",
    ownerId: "HOST001",
    closed: false,
    createdAt: iso(),
    dataClassification: "synthetic-test",
  },
  {
    id: "sales-post",
    name: "Sales Excellence · Summit",
    phase: "post",
    preRoomId: "sales-pre",
    durationMinutes: 60,
    batch: "Sales · November 2026",
    ownerId: "HOST001",
    closed: false,
    createdAt: iso(),
    dataClassification: "synthetic-test",
  },
  {
    id: "summit-next",
    scoringVersion: "corporate-60-v1",
    name: "AI Productivity Benchmark",
    phase: "post",
    preRoomId: "ai-productivity-pre",
    durationMinutes: 60,
    batch: "Open cohort",
    ownerId: "HOST001",
    closed: false,
    createdAt: iso(),
    dataClassification: "synthetic-test",
  },
];
type FixtureState = "joined" | "active" | "ready" | "submitted" | "graded";
async function exampleFiles() {
  const wb = new ExcelJS.Workbook();
  const sh = wb.addWorksheet("Reconciliation");
  sh.addRow(["Source", "Records", "Status"]);
  sh.addRow(["Emails", 100, "Reviewed"]);
  sh.addRow(["Tables", 500, "Reconciled"]);
  sh.addRow(["Customers", 183, "Validated"]);
  sh.columns.forEach((c) => (c.width = 23));
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  const docx = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph("Monthly Business Review — Business Review"),
            new Paragraph(
              "Revenue INR 8.4 million. Target INR 8 million. Guru receivables reconciled; renewal risks escalated. This file is supporting evidence for the monthly review.",
            ),
          ],
        },
      ],
    }),
  );
  return {
    xlsx,
    docx,
    csv: Buffer.from(
      "CustomerID,Name,Email,Region\r\nC101,Aditi Rao,aditi@example.test,NORTH\r\nC102,Rahul Shah,rahul@example.test,WEST",
    ),
  };
}
async function fixture(
  s: Storage,
  room: Room,
  who: Identity,
  state: FixtureState,
  selected: TaskId[],
  files: Awaited<ReturnType<typeof exampleFiles>>,
  minutes = 45,
  offset = 0,
) {
  const finished = ["submitted", "graded"].includes(state),
    now = Date.now(),
    started = finished
      ? now - (room.phase === "pre" ? 2 : 1) * 86400000
      : now - 7 * 60000,
    submitted = finished
      ? new Date(started + minutes * 60000).toISOString()
      : null;
  const answers =
    state === "joined"
      ? {}
      : Object.fromEntries(
          selected.map((t) => [
            t,
            answerKey(room.phase)[t].map((q, i) =>
              room.phase === "pre" && i === 3 ? (q.correct + 1) % 4 : q.correct,
            ),
          ]),
        );
  const complete = state === "ready" || finished;
  const evidence: Participant["evidence"] = [];
  for (const task of state === "joined" ? [] : selected) {
    const data =
        task === "mbr" ? files.docx : task === "clean" ? files.csv : files.xlsx,
      ext = task === "mbr" ? "docx" : task === "clean" ? "csv" : "xlsx";
    const hash = createHash("sha256").update(data).digest("hex"),
      eid = `${hash}-${task}`,
      path = `rooms/${room.id}/evidence/${who.id}/${eid}.${ext}`;
    await createJsonBlob(s, path, data);
    evidence.push({
      id: eid,
      task,
      name: `${task}-reviewed-example.${ext}`,
      path,
      size: data.length,
      sha256: hash,
      contentType: "application/octet-stream",
      uploadedAt: new Date(started + 5 * 60000).toISOString(),
    });
  }
  const grades: Participant["grades"] = {};
  if (state === "graded")
    for (const task of selected)
      grades[task] = {
        accuracy:
          room.scoringVersion === "corporate-60-v1"
            ? room.phase === "pre"
              ? 2
              : 3
            : room.phase === "pre"
              ? 4
              : 5,
        quality:
          room.scoringVersion === "corporate-60-v1"
            ? room.phase === "pre"
              ? 1
              : 2
            : room.phase === "pre"
              ? 3 + (offset % 2)
              : 4 + (offset % 2),
        completeness:
          room.scoringVersion === "corporate-60-v1"
            ? room.phase === "pre"
              ? 2
              : 3
            : room.phase === "pre"
              ? 4
              : 5,
        feedback:
          "Calculations reconciled and evidence reviewed. Clear presentation and reliable source traceability.",
        graderId: "HOST001",
        at: new Date(started + minutes * 60000 + 3600000).toISOString(),
      };
  const p: Participant = {
    identity: who,
    roomId: room.id,
    ...(room.scoringVersion ? { scoringVersion: room.scoringVersion } : {}),
    selected: state === "joined" ? [] : selected,
    answers,
    notes:
      state === "joined"
        ? {}
        : Object.fromEntries(
            selected.map((t) => [
              t,
              `Reviewed ${t} source data, reconciled totals and documented assumptions. ${room.phase === "post" ? "Used AI to accelerate first-pass analysis, then independently validated the results." : "Completed independently without generative AI."} `,
            ]),
          ),
    evidence,
    startedAt: state === "joined" ? null : new Date(started).toISOString(),
    deadline:
      state === "joined" ? null : new Date(started + 60 * 60000).toISOString(),
    submittedAt: submitted,
    submissionReason: finished ? "manual" : undefined,
    revision: complete ? 8 : 2,
    mcq: finished ? mark(room.phase, answers, selected) : {},
    grades,
    taskCompletedAt: complete
      ? Object.fromEntries(
          selected.map((t) => [
            t,
            new Date(started + (minutes - 1) * 60000).toISOString(),
          ]),
        )
      : {},
    lastSeenAt: submitted || iso(),
  };
  await createJson(s, participantKey(room.id, who.id), p);
  await mutate<{ rooms: string[] }>(
    s,
    `attendees/${who.id}/rooms.json`,
    (v) => ({ rooms: [...new Set([...(v?.rooms || []), room.id])] }),
  );
}
async function createJsonBlob(s: Storage, key: string, data: Buffer) {
  if (!(await s.read(key)))
    try {
      await s.write(key, data, null);
    } catch (e) {
      if (!(await s.read(key))) throw e;
    }
}
async function seed(s: Storage) {
  if (await getJson(s, "fixture-version.json")) return;
  const files = await exampleFiles();
  for (const room of roomDefinitions)
    await createJson(s, roomKey(room.id), room);
  await createJson(s, "hosts/HOST001/rooms.json", {
    rooms: roomDefinitions.map((r) => r.id),
  });
  const service = new AssessmentService(s);
  await service.defaultRoom();
  await mutate<Room>(s, roomKey("ai-productivity-pre"), (r) => ({
    ...r!,
    dataClassification: "synthetic-test",
  }));
  for (const room of roomDefinitions.filter(
    (r) => r.id === "baseline-pre" || r.id === "baseline-post",
  ))
    await fixture(
      s,
      room,
      testAttendee,
      "graded",
      standard,
      files,
      room.phase === "pre" ? 45 : 28,
    );
  await mutate<{ rooms: string[] }>(s, "attendees/DEMO001/rooms.json", (v) => ({
    rooms: [...new Set([...(v?.rooms || []), "summit-next"])],
  }));
  const names = [
    "Neha Kapoor",
    "Vikram Singh",
    "Aditi Rao",
    "Rahul Shah",
    "Meera Nair",
    "Sanjay Patel",
    "Kavya Iyer",
    "Rohan Das",
  ];
  for (let i = 0; i < names.length; i++) {
    const who: Identity = {
      id: `DEMO${String(i + 2).padStart(3, "0")}`,
      name: names[i],
      email: names[i].toLowerCase().replace(" ", ".") + "@example.test",
      role: "attendee",
      testAccount: true,
    };
    const sales = i >= 5;
    for (const phase of ["pre", "post"] as const) {
      if ((i === 1 || i === 2) && phase === "post") continue;
      const room = roomDefinitions.find(
        (r) =>
          r.id ===
          (sales
            ? `sales-${phase}`
            : phase === "pre"
              ? "baseline-pre"
              : "baseline-post"),
      )!;
      await fixture(
        s,
        room,
        who,
        i === 0 && phase === "pre"
          ? "submitted"
          : i === 1 && phase === "pre"
            ? "active"
            : i === 2 && phase === "pre"
              ? "joined"
              : "graded",
        sales ? ["dashboard", "mbr", "inbox"] : standard,
        files,
        (phase === "pre" ? 48 : 29) + i,
        i,
      );
    }
  }
  await excelReport(new AssessmentService(s), roomDefinitions[1], testHost);
  await createJson(s, "fixture-version.json", { version: 1, seededAt: iso() });
}
async function seedCorporate(s: Storage) {
  if (await getJson(s, "corporate-fixture-version.json")) return;
  const service = new AssessmentService(s),
    files = await exampleFiles();
  const program = await service.createProgram(
    testHost,
    "Orion Finance",
    "Leadership · November 2026",
    "a70288fe-e974-48c3-a538-63e706be2be9",
  );
  for (const id of [program.preRoomId, program.postRoomId]) {
    const room = await service.room(id);
    await fixture(
      s,
      room,
      testAttendee,
      "graded",
      standard,
      files,
      room.phase === "pre" ? 45 : 28,
    );
  }
  await createJson(s, "corporate-fixture-version.json", {
    version: 1,
    seededAt: iso(),
  });
}
export async function ensureTestData(base: Storage, generation: string) {
  assertLocalTestEnabled();
  const s = new LocalTestStorage(base, generation);
  let pending = cache.get(generation);
  if (!pending) {
    pending = seed(s)
      .then(() => seedCorporate(s))
      .catch((e) => {
        cache.delete(generation);
        throw e;
      });
    cache.set(generation, pending);
  }
  await pending;
  return s;
}
