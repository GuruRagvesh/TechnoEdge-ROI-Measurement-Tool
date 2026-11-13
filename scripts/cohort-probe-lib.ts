import { randomUUID } from "node:crypto";
import { AssessmentService, comparison, metrics } from "../src/lib/assessment";
import { answerKey } from "../src/lib/challenges";
import { excelReport, evidenceZip } from "../src/lib/reports";
import type { Storage } from "../src/lib/storage";
import { TASK_IDS, type Identity, type TaskId } from "../src/lib/types";
export async function runCohortProbe(makeStore: () => Storage, count = 20) {
  if (!Number.isInteger(count) || count < 2 || count > 20)
    throw new Error("Probe supports 2–20 synthetic participants");
  const started = Date.now(),
    store = makeStore(),
    service = new AssessmentService(store),
    run = randomUUID();
  const host: Identity = {
    id: "storage-probe-host",
    email: "probe@local.test",
    name: "Storage probe operator",
    role: "host",
    testAccount: true,
  };
  const program = await service.createProgram(
    host,
    "Synthetic Storage Reliability Probe",
    "Probe " + run,
    run,
  );
  const selected: TaskId[] = [...TASK_IDS];
  const people: Identity[] = Array.from({ length: count }, (_, i) => ({
    id: "probe-" + run + "-" + i,
    name: "Synthetic Participant " + (i + 1),
    email: `participant-${i}@local.test`,
    role: "attendee",
    testAccount: true,
  }));
  async function phase(room: string, round: "pre" | "post") {
    await Promise.all(
      people.map(async (who) => {
        const joined = await service.join(room, who);
        const duplicate = await service.join(room, who);
        if (joined.deadline !== duplicate.deadline)
          throw new Error("Duplicate join reset deadline");
        let p = await service.start(room, who.id, selected);
        for (const task of selected)
          p = await service.upload(
            room,
            who.id,
            task,
            task + ".csv",
            Buffer.from(`Participant,Round\n${who.id},${round}`),
          );
        p = await service.save(room, who.id, {
          revision: p.revision,
          answers: Object.fromEntries(
            selected.map((t) => [t, answerKey(round)[t].map((q) => q.correct)]),
          ),
          notes: { inbox: "Synthetic concurrent storage probe" },
          completed: selected,
        });
        const recovered = await new AssessmentService(makeStore()).participant(
          room,
          who.id,
        );
        if (
          recovered?.deadline !== joined.deadline ||
          recovered.evidence.length !== selected.length
        )
          throw new Error("Restart readback failed");
        const [one, two] = await Promise.all([
          service.submit(room, who.id),
          service.submit(room, who.id),
        ]);
        if (one.submittedAt !== two.submittedAt)
          throw new Error("Duplicate submission changed receipt");
        for (const task of selected)
          p = await service.grade(
            room,
            who.id,
            task,
            host,
            {
              accuracy: 3,
              quality: 2,
              completeness: 3,
              feedback: "Synthetic verification only",
            },
            null,
          );
        if (metrics(p).score !== 100) throw new Error("Unexpected final score");
      }),
    );
  }
  await phase(program.preRoomId, "pre");
  await service.close(program.postRoomId, host, false);
  await phase(program.postRoomId, "post");
  const recovered = new AssessmentService(makeStore());
  const participants = await recovered.attendees(program.postRoomId, host);
  if (participants.length !== count)
    throw new Error("Participant count mismatch");
  for (const post of participants) {
    const pre = await recovered.participant(
      program.preRoomId,
      post.identity.id,
    );
    if (!pre || !comparison(pre, post).comparable)
      throw new Error("Paired comparison missing");
    for (const e of post.evidence)
      if (!(await store.read(e.path)))
        throw new Error("Durable evidence missing");
  }
  const report = await excelReport(
      recovered,
      await recovered.room(program.postRoomId),
      host,
    ),
    archive = await evidenceZip(
      recovered,
      await recovered.room(program.postRoomId),
      host,
    );
  return {
    storageAdapter: store.constructor.name,
    participants: count,
    submittedAttempts: count * 2,
    evidenceFiles: count * selected.length * 2,
    eligiblePairs: count,
    programId: program.id,
    reportBytes: report.length,
    archiveBytes: archive.length,
    elapsedMs: Date.now() - started,
    livePilot: false,
    classification: "synthetic-test",
  };
}
