import { describe, expect, it } from "vitest";
import { card, cardsFor, summary, pairOf } from "../src/lib/scorecard";
import { metrics } from "../src/lib/metrics";
import type { Grade, Participant, Room, TaskId } from "../src/lib/types";

const t0 = "2026-11-11T10:00:00.000Z";
const at = (min: number) => new Date(Date.parse(t0) + min * 60000).toISOString();
const grade = (c: number, a: number, q: number, automatic = false): Grade => ({
  completeness: c,
  accuracy: a,
  quality: q,
  feedback: "",
  graderId: "host",
  at: t0,
  ...(automatic ? { automatic: true as const } : {}),
});
const room = (id: string, extra: Partial<Room> = {}): Room => ({
  id,
  name: "Room " + id,
  company: "Orion Finance",
  batch: "Analysts",
  phase: "pre",
  durationMinutes: 60,
  ownerId: "host",
  createdAt: t0,
  closed: false,
  mode: "single",
  scoringVersion: "corporate-60-v1",
  ...extra,
});
function person(id: string, extra: Partial<Participant> = {}): Participant {
  const selected: TaskId[] = ["inbox", "tables", "mbr"];
  return {
    identity: { id, name: "Person " + id, email: id + "@example.com", role: "attendee" } as Participant["identity"],
    roomId: "r1",
    scoringVersion: "corporate-60-v1",
    selected,
    answers: { inbox: [0, 1, 2, 3], tables: [0, 1, 2, 3], mbr: [0, 1, 2, 3] },
    notes: {},
    evidence: selected.map((task, i) => ({
      id: "e" + i,
      task,
      name: task + ".xlsx",
      size: 100,
      sha256: "x",
      path: `rooms/r1/evidence/${id}/x-${task}.xlsx.bin`,
      uploadedAt: at(5),
      contentType: "application/octet-stream",
    })),
    startedAt: t0,
    deadline: at(60),
    submittedAt: at(42),
    submissionReason: "manual",
    revision: 3,
    mcq: { inbox: 4, tables: 3, mbr: 4 },
    grades: { inbox: grade(3, 3, 2), tables: grade(2, 3, 2), mbr: grade(3, 2, 1) },
    taskCompletedAt: { inbox: at(10), tables: at(20), mbr: at(30) },
    lastSeenAt: at(42),
    ...extra,
  };
}

describe("dashboard scorecard is computed from stored records", () => {
  it("finalized attempt: score includes practical marks, MCQ accuracy does not", () => {
    const p = person("a");
    const c = card(room("r1"), p);
    expect(c.score).toBe(54); // 11 correct × 3 = 33 + practical 21
    expect(c.score).toBe(metrics(p).score); // same number as the Excel export
    expect(c.mcqCorrect).toBe(11);
    expect(c.mcqAnswered).toBe(12);
    expect(c.accuracy).toBe(91.7); // 11 ÷ 12, practical excluded
    expect(c.attempted).toBe(3);
    expect(c.minutes).toBe(42);
    expect(c.status).toBe("Evaluated");
    expect(c.evaluation).toBe("Finalized");
    expect([c.evidenceReceived, c.evidenceExpected, c.completion]).toEqual([3, 3, 100]);
    expect(c.challenges.map((x) => [x.task, x.mcqMarks, x.practical, x.total])).toEqual([
      ["inbox", 12, 8, 20],
      ["tables", 9, 7, 16],
      ["mbr", 12, 6, 18],
    ]);
    // Single assessment: no matched Pre/Post, so nothing is invented.
    expect([c.pre, c.post, c.improvement]).toEqual([null, null, null]);
  });

  it("submitted but not evaluated: no score yet, accuracy known, evaluation pending", () => {
    const c = card(room("r1"), person("b", { grades: { inbox: grade(3, 3, 2) } }));
    expect(c.score).toBeNull();
    expect(c.status).toBe("Submitted");
    expect(c.evaluation).toBe("Pending");
    expect(c.accuracy).toBe(91.7);
    expect(c.challenges.map((x) => x.total)).toEqual([20, null, null]);
  });

  it("in progress: no accuracy, time or score before submission; progress counts are live", () => {
    const c = card(
      room("r1"),
      person("c", {
        submittedAt: null,
        submissionReason: undefined,
        mcq: {},
        grades: {},
        answers: { inbox: [0, 1, 2, 3], tables: [0, -1, -1, -1] },
        evidence: [],
        taskCompletedAt: {},
      }),
    );
    expect(c.status).toBe("In progress");
    expect(c.evaluation).toBe("Not submitted");
    expect([c.score, c.accuracy, c.minutes, c.mcqCorrect]).toEqual([null, null, null, null]);
    expect(c.mcqAnswered).toBe(5);
    expect([c.evidenceReceived, c.completion]).toEqual([0, 0]);
    expect(c.challenges.every((x) => x.mcqMarks === null && x.evidence === null)).toBe(true);
  });

  it("deadline with unanswered questions: accuracy is correct ÷ answered; automatic zero flagged", () => {
    const c = card(
      room("r1"),
      person("d", {
        submissionReason: "deadline",
        submittedAt: at(60),
        answers: { inbox: [0, 1, 2, 3], tables: [0, 1, -1, -1], mbr: [] },
        mcq: { inbox: 4, tables: 1, mbr: 0 },
        evidence: [],
        grades: { inbox: grade(0, 0, 0, true), tables: grade(0, 0, 0, true), mbr: grade(0, 0, 0, true) },
        taskCompletedAt: {},
      }),
    );
    expect(c.endedAtDeadline).toBe(true);
    expect(c.mcqAnswered).toBe(6);
    expect(c.accuracy).toBe(83.3); // 5 of 6 answered
    expect(c.score).toBe(15); // 5 × 3, practical 0
    expect(c.challenges.every((x) => x.automaticZero && x.evidence === null)).toBe(true);
    expect(c.minutes).toBe(60);
  });

  it("Pre/Post appears only for a matched, evaluated pair and is counted once", () => {
    const pre = room("p1", { phase: "pre", mode: undefined, programId: "prog" });
    const post = room("p2", { phase: "post", mode: undefined, programId: "prog", preRoomId: "p1" });
    const a1 = person("a", { roomId: "p1", mcq: { inbox: 3, tables: 2, mbr: 3 } }); // 24 + 21 = 45
    const a2 = person("a", { roomId: "p2" }); // 54
    const b1 = person("b", { roomId: "p1" });
    const b2 = person("b", { roomId: "p2", selected: ["inbox", "clean", "mbr"] }); // different tasks
    const cards = cardsFor([
      { room: pre, participants: [a1, b1] },
      { room: post, participants: [a2, b2] },
    ]);
    const a = cards.filter((c) => c.participantId === "a");
    expect(a.map((c) => [c.pre, c.post, c.improvement])).toEqual([
      [45, 54, 9],
      [45, 54, 9],
    ]);
    expect(cards.filter((c) => c.participantId === "b").every((c) => c.pre === null)).toBe(true);
    expect(pairOf(b1, b2)).toBeNull();
    const s = summary(cards);
    expect([s.pairs, s.pre, s.post, s.improvement]).toEqual([1, 45, 54, 9]);
  });

  it("host summary reconciles with the individual records", () => {
    const r = room("r1");
    const cards = cardsFor([
      {
        room: r,
        participants: [
          person("a"), // 54, 42 min
          person("b", { submittedAt: at(30), grades: {} }), // pending
          person("c", { submittedAt: null, mcq: {}, grades: {}, evidence: [], taskCompletedAt: {} }),
          person("d", { startedAt: null, deadline: null, submittedAt: null, selected: [], answers: {}, mcq: {}, grades: {}, evidence: [], taskCompletedAt: {} }),
        ],
      },
    ]);
    const s = summary(cards);
    expect([s.attempts, s.started, s.submitted, s.finalized, s.pending]).toEqual([4, 3, 2, 1, 1]);
    expect(s.score).toBe(54);
    expect(s.minutes).toBe(36); // (42 + 30) / 2
    expect([s.mcqCorrect, s.mcqAnswered, s.accuracy]).toEqual([22, 24, 91.7]);
    expect([s.evidenceReceived, s.evidenceExpected]).toEqual([6, 9]);
    expect(s.completion).toBe(66.7); // (100 + 100 + 0) / 3 started
    expect(s.status.map((x) => x.count)).toEqual([1, 1, 1, 1]);
    expect(s.pairs).toBe(0);
    expect([s.pre, s.post, s.improvement]).toEqual([null, null, null]);
    const inbox = s.challenges.find((x) => x.task === "inbox")!;
    expect([inbox.attempts, inbox.mcqMarks, inbox.practical, inbox.total, inbox.evaluated]).toEqual([2, 12, 8, 20, 1]);
    expect(s.challenges.find((x) => x.task === "clean")!.attempts).toBe(0);
  });
});
