import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { AssessmentService } from "../src/lib/assessment";
import { metrics } from "../src/lib/metrics";
import { answerKey, mark } from "../src/lib/challenges";
import { excelReport } from "../src/lib/reports";
import { materials } from "../src/lib/materials";
import { MemoryStorage, attendee, host } from "./helpers";
import type { Room, TaskId } from "../src/lib/types";

describe("single-round release: one 60-minute attempt, three of five", () => {
  let store: MemoryStorage, service: AssessmentService, now: number;
  const selected: TaskId[] = ["inbox", "tables", "mbr"];
  const other = {
    ...attendee,
    id: "person-b",
    name: "Person B",
    email: "b@example.com",
  };
  const previous = process.env.ASSESSMENT_MODE;
  beforeAll(() => {
    delete process.env.ASSESSMENT_MODE; // release default
  });
  afterAll(() => {
    process.env.ASSESSMENT_MODE = previous;
  });
  beforeEach(async () => {
    store = new MemoryStorage();
    now = Date.parse("2026-11-11T09:00:00Z");
    service = new AssessmentService(store, () => now);
    await service.defaultRoom();
  });
  const program = (id = randomUUID()) =>
    service.createProgram(host, "Orion Finance", "Pilot 01", id);
  const sheetRows = (wb: ExcelJS.Workbook, name: string) => {
    const rows: unknown[][] = [];
    wb.getWorksheet(name)!.eachRow((r) =>
      rows.push((r.values as unknown[]).slice(1)),
    );
    return rows;
  };

  it("creates exactly one open room, idempotently, and lists no shared default room", async () => {
    const id = randomUUID(),
      [a, b] = await Promise.all([program(id), program(id)]);
    expect(a.id).toBe(b.id);
    expect(a.mode).toBe("single");
    expect(a.postRoomId).toBe("");
    const rooms = await service.rooms(host);
    expect(rooms.map((r) => r.id)).toEqual([a.preRoomId]);
    expect(rooms[0]).toMatchObject({
      mode: "single",
      phase: "pre",
      closed: false,
      durationMinutes: 60,
      scoringVersion: "corporate-60-v1",
    });
    expect(await service.rooms(attendee)).toEqual([]);
    await expect(
      service.validateJoin("ai-productivity-pre", attendee),
    ).rejects.toMatchObject({ code: "INVALID_ROOM" });
    await expect(service.validateJoin("nope", attendee)).rejects.toMatchObject({
      code: "INVALID_ROOM",
    });
  });

  it("starts one timer on join, never resets it, and blocks a second attempt", async () => {
    const p = await program(),
      room = p.preRoomId;
    const first = await service.join(room, attendee);
    expect(Date.parse(first.deadline!) - Date.parse(first.startedAt!)).toBe(
      3600000,
    );
    now += 10 * 60000;
    const again = await service.join(room, attendee);
    expect(again.startedAt).toBe(first.startedAt);
    expect(again.deadline).toBe(first.deadline);
    await expect(
      service.start(room, attendee.id, ["inbox", "tables"] as TaskId[]),
    ).rejects.toThrow("exactly three");
    await service.start(room, attendee.id, selected);
    await expect(
      service.start(room, attendee.id, ["inbox", "tables", "clean"]),
    ).rejects.toThrow("locked");
    now += 51 * 60000; // past the 60-minute deadline
    const expired = await service.participant(room, attendee.id);
    expect(expired?.submissionReason).toBe("deadline");
    expect(expired?.submittedAt).toBe(first.deadline);
    await expect(service.join(room, attendee)).rejects.toMatchObject({
      code: "ATTEMPT_EXPIRED",
    });
    await expect(
      service.save(room, attendee.id, {
        revision: expired!.revision,
        answers: {},
        notes: {},
        completed: [],
      }),
    ).rejects.toThrow("locked");
  });

  it("scores 60, applies the no-evidence zero policy and exports the six required sheets", async () => {
    const p = await program(),
      room = p.preRoomId,
      key = answerKey("pre");
    // Participant A: everything correct, evidence for all three, manual submit.
    await service.join(room, attendee);
    let a = await service.start(room, attendee.id, selected);
    for (const t of selected)
      a = await service.upload(
        room,
        attendee.id,
        t,
        t + ".xlsx",
        Buffer.from("PK-test-" + t),
      );
    now += 60000;
    a = await service.save(room, attendee.id, {
      revision: a.revision,
      answers: Object.fromEntries(
        selected.map((t) => [t, key[t].map((q) => q.correct)]),
      ),
      notes: {},
      completed: selected,
    });
    const savedAt = a.answerSavedAt!.inbox![0];
    now += 60000;
    // Re-saving an unchanged answer keeps its original save time.
    a = await service.save(room, attendee.id, {
      revision: a.revision,
      answers: a.answers,
      notes: { inbox: "method" },
      completed: selected,
    });
    expect(a.answerSavedAt!.inbox![0]).toBe(savedAt);
    a = await service.submit(room, attendee.id);
    expect(await service.submit(room, attendee.id)).toEqual(a); // double submit is a no-op
    expect(metrics(a)).toMatchObject({
      mcqMarks: 36,
      fullyGraded: false,
      score: null,
    });
    await expect(service.join(room, attendee)).rejects.toMatchObject({
      code: "ATTEMPT_SUBMITTED",
    });

    // Participant B: two answers on one challenge, one evidence file, then expiry.
    await service.join(room, other);
    let b = await service.start(room, other.id, selected);
    b = await service.upload(
      room,
      other.id,
      "inbox",
      "inbox.xlsx",
      Buffer.from("PK-b"),
    );
    b = await service.save(room, other.id, {
      revision: b.revision,
      answers: {
        inbox: [key.inbox[0].correct, (key.inbox[1].correct + 1) % 4, -1, -1],
      },
      notes: {},
      completed: [],
    });
    now += 61 * 60000;
    b = (await service.participant(room, other.id))!;
    expect(b.submissionReason).toBe("deadline");
    expect(b.grades.tables).toMatchObject({
      automatic: true,
      graderId: "system",
      accuracy: 0,
    });
    expect(b.grades.mbr?.automatic).toBe(true);
    expect(b.grades.inbox).toBeUndefined(); // evidence exists, so a host must grade it

    // Before grading: totals are Pending, never a misleading percentage.
    let wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await excelReport(service, await service.room(room), host)) as never,
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Participants",
      "Question Answers",
      "Challenge Results",
      "Overall Results",
      "Evidence Log",
      "Data Dictionary",
    ]);
    let overall = sheetRows(wb, "Overall Results");
    expect(overall[1][6]).toBe("Pending");
    expect(overall[1][7]).toBeUndefined();
    expect(overall[1][8]).toBe("Pending practical evaluation");

    for (const t of selected)
      await service.grade(room, attendee.id, t, host, {
        completeness: 3,
        accuracy: 3,
        quality: 2,
        feedback: "Verified evidence",
      });
    await service.grade(room, other.id, "inbox", host, {
      completeness: 1,
      accuracy: 1,
      quality: 1,
      feedback: "Partial workbook",
    });
    await expect(
      service.grade(room, attendee.id, "inbox", host, {
        completeness: 4,
        accuracy: 3,
        quality: 2,
        feedback: "Too high",
      }),
    ).rejects.toThrow("rubric");

    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await excelReport(service, await service.room(room), host)) as never,
    );
    const people = sheetRows(wb, "Participants"),
      answers = sheetRows(wb, "Question Answers"),
      results = sheetRows(wb, "Challenge Results"),
      log = sheetRows(wb, "Evidence Log");
    overall = sheetRows(wb, "Overall Results");
    const rowA = (rows: unknown[][]) =>
        rows.filter((r) => r[0] === attendee.id),
      rowB = (rows: unknown[][]) => rows.filter((r) => r[0] === other.id);
    expect(rowA(people)[0][11]).toBe("FINALIZED");
    expect(rowB(people)[0][11]).toBe("EXPIRED");
    expect(rowA(answers)).toHaveLength(12);
    expect(rowA(answers).every((r) => r[9] === "Yes" && r[10] === 3)).toBe(
      true,
    );
    expect(rowB(answers)).toHaveLength(2); // only answered questions are listed
    expect(rowB(answers).map((r) => r[10])).toEqual([3, 0]);
    expect(rowA(results).map((r) => r[6])).toEqual([20, 20, 20]);
    expect(rowB(results).map((r) => [r[4], r[5], r[6], r[10]])).toEqual([
      [3, 3, 6, "1 file(s) received"],
      [0, 0, 0, "No evidence submitted"],
      [0, 0, 0, "No evidence submitted"],
    ]);
    expect(rowA(overall)[0].slice(4, 9)).toEqual([36, 24, 60, 100, "Final"]);
    expect(rowB(overall)[0].slice(4, 9)).toEqual([3, 3, 6, 10, "Final"]);
    expect(rowA(log).map((r) => r[2])).toEqual([
      "Attempt started",
      "Evidence upload confirmed",
      "Evidence upload confirmed",
      "Evidence upload confirmed",
      "Final submission by participant",
    ]);
    expect(rowB(log).at(-1)![2]).toContain("expired");
    expect(wb.getWorksheet("Pre Post comparisons")).toBeUndefined();
    expect(wb.getWorksheet("Modeled ROI")).toBeUndefined();
  });

  it("keeps hosts isolated and serves a neutral single-round material pack", async () => {
    const p = await program();
    const stranger = { ...host, id: "host-b", email: "other@example.com" };
    await expect(service.attendees(p.preRoomId, stranger)).rejects.toThrow(
      "cannot manage",
    );
    await expect(
      excelReport(service, await service.room(p.preRoomId), stranger),
    ).rejects.toThrow("cannot manage");
    await expect(service.attendees(p.preRoomId, attendee)).rejects.toThrow();
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(
      await materials("inbox", "pre", "corporate-60-v1", true),
    );
    const readme = await zip.file("READ_ME.txt")!.async("string");
    expect(readme).toContain("One attempt per participant.");
    expect(readme).not.toMatch(/Summit|Pre-AI|Post-AI|\| PRE/);
  });
});

const selected: TaskId[] = ["inbox", "tables", "mbr"];
describe("balanced-v2 answer options", () => {
  const phases = ["pre", "post"] as const;
  it("keeps every correct value, with four distinct ascending options", () => {
    for (const phase of phases) {
      const before = answerKey(phase, "sequential-v1"),
        after = answerKey(phase, "balanced-v2");
      for (const t of Object.keys(after) as TaskId[])
        after[t].forEach((q, i) => {
          const old = before[t][i];
          expect(q.options[q.correct]).toBe(old.options[old.correct]);
          expect(q.prompt).toBe(old.prompt);
          const n = q.options.map(Number);
          expect(new Set(n).size).toBe(4);
          expect(n).toEqual([...n].sort((a, b) => a - b));
        });
    }
  });
  it("leaves no position or rounding pattern", () => {
    const all: number[] = [];
    for (const phase of phases)
      for (const qs of Object.values(answerKey(phase, "balanced-v2"))) {
        const pos = qs.map((q) => q.correct);
        all.push(...pos);
        for (const x of [0, 1, 2, 3])
          expect(pos.filter((y) => y === x).length).toBeLessThanOrEqual(2);
        expect(pos.join("")).not.toBe("0123");
        for (const q of qs) {
          // A distractor is never less round than the answer.
          const v = Number(q.options[q.correct]);
          let unit = 1;
          while (v !== 0 && v % (unit * 10) === 0) unit *= 10;
          for (const o of q.options) expect(Number(o) % unit).toBe(0);
        }
      }
    for (const x of [0, 1, 2, 3])
      expect(all.filter((y) => y === x).length).toBeGreaterThanOrEqual(6);
  });
  it("is identical on every call, so saved answer indices stay valid", () => {
    expect(answerKey("pre", "balanced-v2")).toEqual(
      answerKey("pre", "balanced-v2"),
    );
  });
  it("marks a room created before balanced-v2 with its original layout", async () => {
    let clock = Date.parse("2026-11-11T09:00:00Z");
    const store = new MemoryStorage(),
      service = new AssessmentService(store, () => clock);
    const legacy: Room = {
      id: "legacy-room",
      name: "AI Productivity Benchmark",
      phase: "pre",
      durationMinutes: 60,
      ownerId: host.id,
      batch: "Earlier cohort",
      createdAt: "2026-11-01T00:00:00Z",
      closed: false,
      scoringVersion: "corporate-60-v1",
    };
    await store.write(
      "rooms/legacy-room/room.json",
      Buffer.from(JSON.stringify(legacy)),
      null,
    );
    const old = answerKey("pre", "sequential-v1");
    await service.join("legacy-room", attendee);
    let p = await service.start("legacy-room", attendee.id, selected);
    p = await service.save("legacy-room", attendee.id, {
      revision: p.revision,
      answers: Object.fromEntries(
        selected.map((t) => [t, old[t].map((q) => q.correct)]),
      ),
      notes: {},
      completed: [],
    });
    clock += 61 * 60000; // the deadline finalizes and marks the saved answers
    p = (await service.participant("legacy-room", attendee.id))!;
    expect(p.submissionReason).toBe("deadline");
    expect(p.mcq).toEqual({ inbox: 4, tables: 4, mbr: 4 });
    expect(mark("pre", p.answers, selected, "sequential-v1")).toEqual(p.mcq);
  });
});
