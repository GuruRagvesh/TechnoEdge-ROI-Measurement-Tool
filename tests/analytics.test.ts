import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AssessmentService } from "../src/lib/assessment";
import { answerKey, layoutOf } from "../src/lib/challenges";
import { analytics } from "../src/lib/analytics";
import { metrics } from "../src/lib/metrics";
import { MemoryStorage, attendee, host } from "./helpers";
import type { TaskId } from "../src/lib/types";

// Dashboard numbers must reconcile with the stored participant records.
describe("host dashboard aggregates", () => {
  let store: MemoryStorage, service: AssessmentService, now: number;
  const person = (n: number) => ({
    ...attendee,
    id: "p" + n,
    name: "Person " + n,
    email: `p${n}@example.com`,
  });
  beforeEach(() => {
    store = new MemoryStorage();
    now = Date.parse("2026-11-11T09:00:00Z");
    service = new AssessmentService(store, () => now);
  });
  async function attempt(
    room: string,
    n: number,
    selected: TaskId[],
    opts: { submit: boolean; grade?: [number, number, number]; wrong?: number },
  ) {
    const who = person(n);
    await service.join(room, who);
    let p = await service.start(room, who.id, selected);
    const key = answerKey("pre", layoutOf(await service.room(room)));
    for (const t of selected)
      p = await service.upload(
        room,
        who.id,
        t,
        t + ".csv",
        Buffer.from(`Result,Value
${t},${n}`),
      );
    p = await service.save(room, who.id, {
      revision: p.revision,
      answers: Object.fromEntries(
        selected.map((t) => [
          t,
          key[t].map((q, i) =>
            i < (opts.wrong ?? 0) ? (q.correct + 1) % 4 : q.correct,
          ),
        ]),
      ),
      notes: {},
      completed: selected,
    });
    if (!opts.submit) return;
    now += 30 * 60000;
    await service.submit(room, who.id);
    now -= 30 * 60000;
    if (opts.grade)
      for (const t of selected)
        await service.grade(room, who.id, t, host, {
          completeness: opts.grade[0],
          accuracy: opts.grade[1],
          quality: opts.grade[2],
          feedback: "ok",
        });
  }
  it("reconciles KPIs, funnel, challenge, question and score figures with records", async () => {
    const a = await service.createProgram(host, "Orion", "C1", randomUUID());
    const b = await service.createProgram(host, "Vega", "C2", randomUUID());
    await attempt(a.preRoomId, 1, ["inbox", "tables", "mbr"], {
      submit: true,
      grade: [3, 3, 2],
    });
    await attempt(a.preRoomId, 2, ["inbox", "clean", "dashboard"], {
      submit: true,
      grade: [2, 2, 1],
      wrong: 2,
    });
    await attempt(a.preRoomId, 3, ["tables", "clean", "mbr"], { submit: true });
    await attempt(b.preRoomId, 4, ["dashboard", "clean", "mbr"], {
      submit: false,
    });
    const data = await Promise.all(
      [a.preRoomId, b.preRoomId].map(async (id) => {
        const room = await service.room(id),
          participants = await service.attendees(id, host),
          key = answerKey(room.phase, layoutOf(room));
        // Same aggregation as the host participants endpoint.
        const questionStats = Object.fromEntries(
          Object.entries(key).map(([t, qs]) => [
            t,
            qs.map((q, i) => {
              let answered = 0,
                correct = 0;
              for (const p of participants) {
                const x = p.submittedAt
                  ? p.answers[t as TaskId]?.[i]
                  : undefined;
                if (x !== undefined && x >= 0) {
                  answered++;
                  if (x === q.correct) correct++;
                }
              }
              return { answered, correct };
            }),
          ]),
        );
        return { room, participants, questionStats };
      }),
    );
    const all = analytics(data, { roomId: "all", status: "all" });
    expect(all.kpis).toMatchObject({
      participants: 4,
      attempts: 4,
      submitted: 3,
      pending: 1,
      evaluated: 2,
      completionRate: 75,
      averageMinutes: 30,
    });
    // Person 1: 36 + 24 = 60; person 2: (12-6)*... 2 wrong per task → 6 correct of 12 → 18 + 15 = 33.
    const scores = data
      .flatMap((d) => d.participants)
      .map((p) => metrics(p).score)
      .filter((x): x is number => x !== null);
    expect(scores.sort()).toEqual([33, 60]);
    expect(all.kpis.averageScore).toBe(46.5);
    expect(all.funnel.map((f) => f.count)).toEqual([4, 4, 3, 2]);
    expect(all.status.map((s) => s.count)).toEqual([1, 1, 2]);
    const clean = all.challenges.find((c) => c.task === "clean")!;
    expect(clean).toMatchObject({
      selections: 3,
      submitted: 2,
      evidenceRate: 100,
    });
    // clean: person 2 had 2/4 correct (6 marks), person 3 4/4 (12) → 9.
    expect(clean.averageMcq).toBe(9);
    const q1 = all.questionAccuracy.find((c) => c.task === "inbox")!.questions;
    expect(q1.map((q) => [q.correct, q.answered])).toEqual([
      [1, 2],
      [1, 2],
      [2, 2],
      [2, 2],
    ]);
    expect(all.scoreBins.find((b) => b.label === "50–60")!.count).toBe(1);
    expect(all.scoreBins.find((b) => b.label === "30–39")!.count).toBe(1);
    expect(all.rubric[0]).toMatchObject({ average: 2.5, percent: 83.3 });
    expect(all.queue.map((r) => r.participant.identity.id)).toEqual(["p3"]);
    const onlyB = analytics(data, { roomId: b.preRoomId, status: "all" });
    expect(onlyB.kpis).toMatchObject({
      participants: 1,
      submitted: 0,
      averageScore: null,
    });
    const pendingOnly = analytics(data, {
      roomId: "all",
      status: "Awaiting evaluation",
    });
    expect(pendingOnly.rows.map((r) => r.participant.identity.id)).toEqual([
      "p3",
    ]);
  });
});
