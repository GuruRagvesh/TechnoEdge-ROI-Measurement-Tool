import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import {
  AssessmentService,
  comparison,
  participantKey,
  roomKey,
} from "../src/lib/assessment";
import { metrics } from "../src/lib/metrics";
import { answerKey } from "../src/lib/challenges";
import { getJson, mutate, LocalStorage } from "../src/lib/storage";
import { excelReport } from "../src/lib/reports";
import { MemoryStorage, attendee, host } from "./helpers";
import {
  TASK_IDS,
  type Participant,
  type Room,
  type TaskId,
} from "../src/lib/types";
describe("corporate programs and versioned attempts", () => {
  let store: MemoryStorage, service: AssessmentService, now: number;
  const selected: TaskId[] = [...TASK_IDS];
  beforeEach(async () => {
    store = new MemoryStorage();
    now = Date.parse("2026-11-06T09:00:00Z");
    service = new AssessmentService(store, () => now);
    await service.defaultRoom();
  });
  async function program() {
    return service.createProgram(
      host,
      "Orion Finance",
      "Leadership 03",
      randomUUID(),
    );
  }
  async function complete(room: string, phase: "pre" | "post") {
    await service.join(room, attendee);
    let p = await service.start(room, attendee.id, selected);
    for (const t of selected)
      p = await service.upload(
        room,
        attendee.id,
        t,
        t + ".csv",
        Buffer.from("Result,Value\nTotal,100"),
      );
    p = await service.save(room, attendee.id, {
      revision: p.revision,
      answers: Object.fromEntries(
        selected.map((t) => [t, answerKey(phase)[t].map((q) => q.correct)]),
      ),
      notes: {},
      completed: selected,
    });
    p = await service.submit(room, attendee.id);
    for (const t of selected)
      p = await service.grade(
        room,
        attendee.id,
        t,
        host,
        {
          accuracy: 3,
          quality: 2,
          completeness: 3,
          feedback: "Verified evidence",
        },
        null,
      );
    return p;
  }
  it("creates exactly two fixed linked rooms idempotently even with concurrent duplicate requests", async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([
      service.createProgram(host, "Orion", "Batch 01", key),
      service.createProgram(host, "Orion", "Batch 01", key),
    ]);
    expect(a).toEqual(b);
    expect(a.ready).toBe(true);
    const pre = await service.room(a.preRoomId),
      post = await service.room(a.postRoomId);
    expect(pre).toMatchObject({
      closed: false,
      phase: "pre",
      durationMinutes: 60,
      scoringVersion: "corporate-all5-v2",
    });
    expect(post).toMatchObject({
      closed: true,
      phase: "post",
      preRoomId: pre.id,
      durationMinutes: 60,
    });
    expect(
      (await service.rooms(host)).filter((r) => r.programId === a.id),
    ).toHaveLength(2);
    await expect(
      service.createProgram(host, "Different", "Batch 01", key),
    ).rejects.toThrow("already used");
    await expect(
      service.createProgram(attendee, "Orion", "Batch 01", key),
    ).rejects.toThrow("Host");
  });
  it("recovers partially created programs after a storage failure without creating duplicate rooms", async () => {
    const key = randomUUID(),
      write = store.write.bind(store);
    let count = 0;
    store.write = async (...args) => {
      if (++count === 4) throw new Error("Interrupted creation");
      return write(...args);
    };
    await expect(
      service.createProgram(host, "Orion", "Batch 01", key),
    ).rejects.toThrow("Interrupted");
    store.write = write;
    const p = await service.createProgram(host, "Orion", "Batch 01", key);
    expect(p.ready).toBe(true);
    expect(
      (await service.rooms(host)).filter((r) => r.programId === p.id),
    ).toHaveLength(2);
  });
  it("validation never starts the timer; confirmed joins assign all five once", async () => {
    const p = await program();
    await service.validateJoin(p.preRoomId, attendee);
    expect(await service.participant(p.preRoomId, attendee.id)).toBeNull();
    const [a, b] = await Promise.all([
      service.join(p.preRoomId, attendee),
      service.join(p.preRoomId, attendee),
    ]);
    expect(a.deadline).toBe(b.deadline);
    expect(a.selected).toEqual(selected);
    now += 60000;
    const resumed = await new AssessmentService(store, () => now).join(
      p.preRoomId,
      attendee,
    );
    expect(resumed.deadline).toBe(a.deadline);
    const started = await service.start(p.preRoomId, attendee.id, selected);
    expect(started.deadline).toBe(a.deadline);
  });
  it("expires during the assessment and rejects joins, starts and writes after expiry", async () => {
    const p = await program(),
      a = await service.join(p.preRoomId, attendee);
    now = Date.parse(a.deadline!);
    await expect(service.join(p.preRoomId, attendee)).rejects.toMatchObject({
      code: "ATTEMPT_EXPIRED",
    });
    await expect(
      service.start(p.preRoomId, attendee.id, selected),
    ).rejects.toThrow("locked");
    expect(
      (await service.participant(p.preRoomId, attendee.id))?.submissionReason,
    ).toBe("deadline");
  });
  it("recovers a confirmed join whose attendee index write was interrupted without resetting the deadline", async () => {
    const p = await program(),
      write = store.write.bind(store);
    let failed = false;
    store.write = async (...args) => {
      if (!failed && args[0].startsWith("attendees/")) {
        failed = true;
        throw new Error("Interrupted index");
      }
      return write(...args);
    };
    await expect(service.join(p.preRoomId, attendee)).rejects.toThrow(
      "Interrupted index",
    );
    const durable = (await service.participant(p.preRoomId, attendee.id))!;
    now += 120000;
    store.write = write;
    const resumed = await new AssessmentService(store, () => now).join(
      p.preRoomId,
      attendee,
    );
    expect(resumed.deadline).toBe(durable.deadline);
    expect(
      (await service.rooms(attendee)).some((r) => r.id === p.preRoomId),
    ).toBe(true);
  });
  it("distinguishes invalid and closed rooms and enforces ownership and Summit prerequisites", async () => {
    const p = await program();
    await expect(
      service.validateJoin("invalid", attendee),
    ).rejects.toMatchObject({ code: "INVALID_ROOM" });
    await expect(service.join(p.postRoomId, attendee)).rejects.toMatchObject({
      code: "ROOM_CLOSED",
    });
    await expect(
      service.close(p.postRoomId, { ...host, id: "other" }, false),
    ).rejects.toThrow("cannot manage");
    await service.close(p.postRoomId, host, false);
    await expect(service.join(p.postRoomId, attendee)).rejects.toMatchObject({
      code: "PRE_REQUIRED",
    });
  });
  it("marks out of 100, validates the 8-mark rubric, locks submissions, and matches Summit categories", async () => {
    const p = await program();
    const pre = await complete(p.preRoomId, "pre");
    expect(metrics(pre)).toMatchObject({
      score: 100,
      maximum: 100,
      mcqMarks: 60,
      practical: 40,
      quality: 100,
    });
    await expect(
      service.grade(p.preRoomId, attendee.id, "inbox", host, {
        accuracy: 4,
        quality: 2,
        completeness: 3,
        feedback: "Invalid rubric",
      }),
    ).rejects.toThrow("rubric");
    await expect(service.join(p.preRoomId, attendee)).rejects.toMatchObject({
      code: "ATTEMPT_SUBMITTED",
    });
    const [one, two] = await Promise.all([
      service.submit(p.preRoomId, attendee.id),
      service.submit(p.preRoomId, attendee.id),
    ]);
    expect(one.submittedAt).toBe(two.submittedAt);
    await service.close(p.postRoomId, host, false);
    await service.join(p.postRoomId, attendee);
    const matched = await service.start(p.postRoomId, attendee.id, [
      "mbr",
      "dashboard",
      "inbox",
    ]);
    expect(matched.selected).toEqual(selected);
    const post = await complete(p.postRoomId, "post");
    expect(comparison(pre, post).comparable).toBe(true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await excelReport(
        service,
        await service.room(p.postRoomId),
        host,
      )) as never,
    );
    const headers = wb.getWorksheet("Participants")!.getRow(1)
      .values as string[];
    expect(headers).toContain("Scoring version");
    expect(headers).toContain("Maximum score");
    expect(wb.getWorksheet("Task answers")!.getRow(2).getCell(9).value).toBe(3);
  });
  it("preserves unversioned historical results and refuses cross-version comparison", async () => {
    const p = await program(),
      pre = await complete(p.preRoomId, "pre");
    const historic = {
      ...pre,
      scoringVersion: undefined,
      grades: Object.fromEntries(
        selected.map((t) => [
          t,
          {
            accuracy: 5,
            quality: 5,
            completeness: 5,
            feedback: "Historic",
            graderId: host.id,
            at: pre.submittedAt!,
          },
        ]),
      ),
    } as Participant;
    expect(metrics(historic)).toMatchObject({
      score: 100,
      maximum: 100,
      scoringVersion: "legacy-100",
    });
    expect(metrics(pre).score).toBe(100);
    expect(comparison(historic, pre).comparable).toBe(false);
  });
  it("persists confirmed deadlines across actual storage and service restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "technoedge-corporate-"));
    try {
      const first = new AssessmentService(new LocalStorage(dir), () => now);
      const p = await first.createProgram(
        host,
        "Orion",
        "Persistence",
        randomUUID(),
      );
      const joined = await first.join(p.preRoomId, attendee);
      now += 90000;
      const second = new AssessmentService(new LocalStorage(dir), () => now);
      const resumed = await second.join(p.preRoomId, attendee);
      expect(resumed.deadline).toBe(joined.deadline);
      expect(resumed.startedAt).toBe(joined.startedAt);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
