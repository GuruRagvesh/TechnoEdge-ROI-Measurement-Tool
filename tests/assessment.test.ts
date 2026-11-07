import { beforeEach, describe, expect, it } from "vitest";
import {
  AssessmentService,
  comparison,
  metrics,
  participantKey,
} from "../src/lib/assessment";
import { answerKey, mark, publicTasks } from "../src/lib/challenges";
import { getJson, mutate } from "../src/lib/storage";
import type { Participant, TaskId } from "../src/lib/types";
import { MemoryStorage, attendee, host } from "./helpers";
describe("durable assessment lifecycle", () => {
  let store: MemoryStorage, service: AssessmentService, now: number;
  const selected: TaskId[] = ["inbox", "tables", "clean"];
  beforeEach(async () => {
    store = new MemoryStorage();
    now = Date.parse("2026-11-05T09:00:00Z");
    service = new AssessmentService(store, () => now);
    await service.defaultRoom();
    // Existing legacy records retain their 100-point behavior. New-model coverage is separate.
    await mutate<any>(store, "rooms/ai-productivity-pre/room.json", (r) => ({
      ...r,
      scoringVersion: "legacy-100",
    }));
    await service.join("ai-productivity-pre", attendee);
  });
  async function complete(
    room = "ai-productivity-pre",
    phase: "pre" | "post" = "pre",
  ) {
    let p = await service.start(room, attendee.id, selected);
    const answers = Object.fromEntries(
      selected.map((t) => [t, answerKey(phase)[t].map((q) => q.correct)]),
    );
    for (const t of selected)
      p = await service.upload(
        room,
        attendee.id,
        t,
        t + ".csv",
        Buffer.from("Result,Value\r\nTotal,100"),
      );
    p = await service.save(room, attendee.id, {
      revision: p.revision,
      answers,
      notes: { inbox: "Documented method" },
      completed: selected,
    });
    return p;
  }
  it("requires exactly three tasks and locks selection; start is resumable", async () => {
    await expect(
      service.start("ai-productivity-pre", attendee.id, [
        "inbox",
        "inbox",
        "clean",
      ]),
    ).rejects.toThrow("three");
    const first = await service.start(
      "ai-productivity-pre",
      attendee.id,
      selected,
    );
    now += 10000;
    const resumed = await new AssessmentService(store, () => now).start(
      "ai-productivity-pre",
      attendee.id,
      selected,
    );
    expect(resumed.deadline).toBe(first.deadline);
    await expect(
      service.start("ai-productivity-pre", attendee.id, [
        "inbox",
        "dashboard",
        "mbr",
      ]),
    ).rejects.toThrow("locked");
  });
  it("recovers saved work in a new service and prevents stale-tab overwrites", async () => {
    let p = await service.start("ai-productivity-pre", attendee.id, selected);
    const rev = p.revision;
    p = await service.save("ai-productivity-pre", attendee.id, {
      revision: rev,
      answers: { inbox: [1, 2, 3, 0] },
      notes: { inbox: "Saved work" },
      completed: [],
    });
    const recovered = await new AssessmentService(store, () => now).participant(
      "ai-productivity-pre",
      attendee.id,
    );
    expect(recovered?.notes.inbox).toBe("Saved work");
    await expect(
      service.save("ai-productivity-pre", attendee.id, {
        revision: rev,
        answers: { inbox: [0] },
        notes: {},
        completed: [],
      }),
    ).rejects.toThrow("Another tab");
    expect(
      (await service.participant("ai-productivity-pre", attendee.id))?.revision,
    ).toBe(p.revision);
  });
  it("marks correct answers, handles concurrent duplicate submissions, locks writes", async () => {
    await complete();
    now += 25 * 60000;
    const result = await Promise.all([
      service.submit("ai-productivity-pre", attendee.id),
      service.submit("ai-productivity-pre", attendee.id),
    ]);
    expect(result[0].submittedAt).toBe(result[1].submittedAt);
    expect(metrics(result[0]).mcq).toBe(12);
    expect(metrics(result[0]).score).toBeNull();
    await expect(
      service.upload(
        "ai-productivity-pre",
        attendee.id,
        "inbox",
        "late.txt",
        Buffer.from("late"),
      ),
    ).rejects.toThrow("locked");
    for (const t of selected)
      await service.grade("ai-productivity-pre", attendee.id, t, host, {
        accuracy: 5,
        quality: 4,
        completeness: 5,
        feedback: "Evidence verified",
      });
    const p = (await service.participant("ai-productivity-pre", attendee.id))!;
    expect(metrics(p).score).toBe(96);
    expect(metrics(p).quality).toBe(80);
  });
  it("auto-finalizes at exact deadline, including partial saved answers", async () => {
    let p = await service.start("ai-productivity-pre", attendee.id, selected);
    p = await service.save("ai-productivity-pre", attendee.id, {
      revision: p.revision,
      answers: { inbox: [answerKey("pre").inbox[0].correct] },
      notes: {},
      completed: [],
    });
    now += 60 * 60000;
    await expect(
      service.save("ai-productivity-pre", attendee.id, {
        revision: p.revision,
        answers: {},
        notes: {},
        completed: [],
      }),
    ).rejects.toThrow("locked");
    const expired = (await service.participant(
      "ai-productivity-pre",
      attendee.id,
    ))!;
    expect(expired.submissionReason).toBe("deadline");
    expect(expired.submittedAt).toBe(expired.deadline);
    expect(metrics(expired).mcq).toBe(1);
  });
  it("does not accept task completion without evidence or all four answers", async () => {
    const p = await service.start("ai-productivity-pre", attendee.id, selected);
    await expect(
      service.save("ai-productivity-pre", attendee.id, {
        revision: p.revision,
        answers: { inbox: [0, 1, 2, 3] },
        notes: {},
        completed: ["inbox"],
      }),
    ).rejects.toThrow("evidence");
    await expect(
      service.submit("ai-productivity-pre", attendee.id),
    ).rejects.toThrow("Complete all three");
  });
  it("enforces room ownership, closed rooms and grading only submitted work", async () => {
    const room = await service.createRoom(host, {
      name: "Private room",
      batch: "Batch A",
      phase: "pre",
      durationMinutes: 60,
    });
    await expect(
      service.attendees(room.id, { ...host, id: "other-host" }),
    ).rejects.toThrow("cannot manage");
    await service.close(room.id, host, true);
    await expect(service.join(room.id, attendee)).rejects.toThrow("closed");
    await expect(
      service.grade("ai-productivity-pre", attendee.id, "inbox", host, {
        accuracy: 5,
        quality: 5,
        completeness: 5,
        feedback: "test",
      }),
    ).rejects.toThrow("Submit");
  });
  it("preserves same identity and categories in Post, with different correct values", async () => {
    await complete();
    now += 40 * 60000;
    await service.submit("ai-productivity-pre", attendee.id);
    for (const t of selected)
      await service.grade("ai-productivity-pre", attendee.id, t, host, {
        accuracy: 5,
        quality: 5,
        completeness: 5,
        feedback: "Good baseline",
      });
    const room = await service.createRoom(host, {
      name: "Summit",
      phase: "post",
      batch: "Open cohort",
      durationMinutes: 60,
      preRoomId: "ai-productivity-pre",
    });
    await expect(
      service.join(room.id, { ...attendee, id: "new-email" }),
    ).rejects.toThrow("Base Camp");
    await service.join(room.id, attendee);
    const started = await service.start(room.id, attendee.id, [
      "dashboard",
      "mbr",
      "inbox",
    ]);
    expect(started.selected).toEqual(selected);
    await complete(room.id, "post");
    now += 20 * 60000;
    await service.submit(room.id, attendee.id);
    for (const t of selected)
      await service.grade(room.id, attendee.id, t, host, {
        accuracy: 5,
        quality: 5,
        completeness: 5,
        feedback: "Good Summit",
      });
    const pre = (await service.participant(
        "ai-productivity-pre",
        attendee.id,
      ))!,
      post = (await service.participant(room.id, attendee.id))!;
    expect(comparison(pre, post)).toMatchObject({
      comparable: true,
      minutesSaved: 20,
      timeReduction: 50,
      scoreDelta: 0,
    });
    expect(
      answerKey("pre").tables[1].options[answerKey("pre").tables[1].correct],
    ).not.toBe(
      answerKey("post").tables[1].options[answerKey("post").tables[1].correct],
    );
  });
  it("leaves saved records intact on storage failure and retries an upload safely", async () => {
    const p = await service.start("ai-productivity-pre", attendee.id, selected);
    store.failWrites = true;
    await expect(
      service.save("ai-productivity-pre", attendee.id, {
        revision: p.revision,
        answers: {},
        notes: { inbox: "lost" },
        completed: [],
      }),
    ).rejects.toThrow("Injected");
    store.failWrites = false;
    expect(
      (
        await getJson<Participant>(
          store,
          participantKey("ai-productivity-pre", attendee.id),
        )
      )?.notes,
    ).toEqual({});
    await service.upload(
      "ai-productivity-pre",
      attendee.id,
      "inbox",
      "answer.csv",
      Buffer.from("a,b"),
    );
    await service.upload(
      "ai-productivity-pre",
      attendee.id,
      "inbox",
      "answer.csv",
      Buffer.from("a,b"),
    );
    expect(
      (await service.participant("ai-productivity-pre", attendee.id))?.evidence,
    ).toHaveLength(1);
  });
  it("does not disclose keys in public task DTOs and treats missing answers as zero", () => {
    expect(JSON.stringify(publicTasks("pre"))).not.toContain('"correct"');
    expect(mark("pre", {}, selected)).toEqual({
      inbox: 0,
      tables: 0,
      clean: 0,
    });
  });
  it("excludes incomplete submissions from observed improvement and ROI", async () => {
    await complete();
    await service.submit("ai-productivity-pre", attendee.id);
    for (const t of selected)
      await service.grade("ai-productivity-pre", attendee.id, t, host, {
        accuracy: 5,
        quality: 5,
        completeness: 5,
        feedback: "Verified",
      });
    const p = (await service.participant("ai-productivity-pre", attendee.id))!;
    expect(
      comparison(p, {
        ...p,
        taskCompletedAt: { inbox: p.taskCompletedAt.inbox },
      }),
    ).toMatchObject({
      comparable: false,
      minutesSaved: null,
      timeReduction: null,
    });
  });
  it("rejects stale evaluation edits and preserves evaluation history", async () => {
    await complete();
    await service.submit("ai-productivity-pre", attendee.id);
    await service.grade(
      "ai-productivity-pre",
      attendee.id,
      "inbox",
      host,
      {
        accuracy: 4,
        quality: 4,
        completeness: 4,
        feedback: "Initial evaluation",
      },
      null,
    );
    await expect(
      service.grade(
        "ai-productivity-pre",
        attendee.id,
        "inbox",
        host,
        {
          accuracy: 5,
          quality: 5,
          completeness: 5,
          feedback: "Stale overwrite",
        },
        null,
      ),
    ).rejects.toThrow("changed");
    expect(
      (await service.participant("ai-productivity-pre", attendee.id))
        ?.gradingHistory,
    ).toHaveLength(1);
  });
  it("recovers an evidence blob after its metadata commit fails", async () => {
    await service.start("ai-productivity-pre", attendee.id, selected);
    const write = store.write.bind(store);
    let injected = true;
    store.write = async (k, b, e) => {
      if (
        injected &&
        k === participantKey("ai-productivity-pre", attendee.id)
      ) {
        injected = false;
        throw new Error("Metadata interrupted");
      }
      return write(k, b, e);
    };
    await expect(
      service.upload(
        "ai-productivity-pre",
        attendee.id,
        "inbox",
        "answer.csv",
        Buffer.from("A,B"),
      ),
    ).rejects.toThrow("interrupted");
    expect(
      [...store.files.keys()].filter((x) => x.includes("/evidence/")),
    ).toHaveLength(1);
    await service.upload(
      "ai-productivity-pre",
      attendee.id,
      "inbox",
      "answer.csv",
      Buffer.from("A,B"),
    );
    expect(
      (await service.participant("ai-productivity-pre", attendee.id))?.evidence,
    ).toHaveLength(1);
    expect(
      [...store.files.keys()].filter((x) => x.includes("/evidence/")),
    ).toHaveLength(1);
  });
});
