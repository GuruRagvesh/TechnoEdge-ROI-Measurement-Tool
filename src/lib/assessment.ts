import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  AppError,
  iso,
  TASK_IDS,
  type Grade,
  type Program,
  type Identity,
  type Participant,
  type Room,
  type TaskId,
} from "./types";
import { createJson, getJson, mutate, type Storage } from "./storage";
import { CURRENT_OPTION_LAYOUT, layoutOf, mark } from "./challenges";
import { assessmentMode, evidenceLimitMB } from "./config";
import { metrics } from "./metrics";
export const roomKey = (id: string) => `rooms/${id}/room.json`;
export const participantKey = (room: string, id: string) =>
  `rooms/${room}/participants/${id}.json`;
const ROOM_TTL_MS = 15_000;
const roomCaches = new WeakMap<
  Storage,
  Map<string, { room: Room; until: number }>
>();
function roomCacheFor(store: Storage) {
  let m = roomCaches.get(store);
  if (!m) roomCaches.set(store, (m = new Map()));
  return m;
}
const defaultRooms = new WeakMap<
  Storage,
  { room: Promise<Room>; expires: number }
>();
export class AssessmentService {
  constructor(
    public store: Storage,
    private clock = () => Date.now(),
  ) {}
  // Ensured once per server instance (re-checked every 5 minutes), not on
  // every request: each attempt is a SharePoint write plus a read.
  async defaultRoom() {
    const ready = defaultRooms.get(this.store);
    if (ready && ready.expires > Date.now()) return ready.room;
    const room = this.createDefaultRoom();
    defaultRooms.set(this.store, { room, expires: Date.now() + 300_000 });
    room.catch(() => defaultRooms.delete(this.store));
    return room;
  }
  private createDefaultRoom() {
    return createJson<Room>(this.store, roomKey("ai-productivity-pre"), {
      scoringVersion: "corporate-all5-v2",
      optionLayout: CURRENT_OPTION_LAYOUT,
      id: "ai-productivity-pre",
      name: "AI Productivity Benchmark",
      phase: "pre",
      durationMinutes: 60,
      ownerId: "default",
      batch: "Open cohort",
      createdAt: iso(),
      closed: false,
    });
  }
  // Room settings change only when a host closes or reopens a room, so each
  // server instance reuses a room record for up to 15 s (this instance sees
  // its own changes at once). Per-participant deadlines are not affected.
  async room(id: string) {
    const cache = roomCacheFor(this.store),
      hit = cache.get(id);
    if (hit && hit.until > Date.now()) return hit.room;
    const r = await getJson<Room>(this.store, roomKey(id));
    if (!r)
      throw new AppError(
        404,
        "Invalid room code. Check the code with your coordinator.",
        "INVALID_ROOM",
      );
    if (cache.size > 2000) cache.clear();
    cache.set(id, { room: r, until: Date.now() + ROOM_TTL_MS });
    return r;
  }
  assertHost(room: Room, host: Identity) {
    if (
      host.role !== "host" ||
      (room.ownerId !== "default" && room.ownerId !== host.id)
    )
      throw new AppError(403, "You cannot manage this room.");
  }
  async createRoom(
    host: Identity,
    input: Pick<
      Room,
      "name" | "batch" | "phase" | "durationMinutes" | "preRoomId"
    >,
  ) {
    if (host.role !== "host") throw new AppError(403, "Host access required.");
    if (input.phase === "post") {
      if (!input.preRoomId) throw new AppError(400, "Link a Pre-AI room.");
      const pre = await this.room(input.preRoomId);
      this.assertHost(pre, host);
      if (
        pre.phase !== "pre" ||
        pre.batch !== input.batch ||
        pre.durationMinutes !== input.durationMinutes
      )
        throw new AppError(
          400,
          "Post-AI room must match the Pre-AI batch and duration.",
        );
    }
    const id = randomBytes(6).toString("hex");
    const room: Room = {
      ...input,
      ...(host.testAccount
        ? { dataClassification: "synthetic-test" as const }
        : {}),
      id,
      ownerId: host.id,
      createdAt: iso(),
      closed: false,
      optionLayout: CURRENT_OPTION_LAYOUT,
    };
    await createJson(this.store, roomKey(id), room);
    // Host index is separate from participant records; concurrent creation merges with CAS.
    await mutate<{ rooms: string[] }>(
      this.store,
      `hosts/${host.id}/rooms.json`,
      (x) => ({ rooms: [...new Set([...(x?.rooms || []), id])] }),
    );
    return room;
  }
  async createProgram(
    host: Identity,
    company: string,
    cohort: string,
    requestId: string,
    // Local synthetic fixtures are paired by design and pass "paired" explicitly.
    mode: "single" | "paired" = assessmentMode(),
  ) {
    if (host.role !== "host") throw new AppError(403, "Host access required.");
    // Stable per-host request ID makes retries recover the same pair, including after partial writes.
    const id = createHash("sha256")
      .update(host.id + ":" + requestId)
      .digest("hex")
      .slice(0, 20);
    const key = "programs/" + id + "/program.json";
    const program = await createJson<Program>(this.store, key, {
      id,
      company,
      cohort,
      ownerId: host.id,
      preRoomId: id + "-pre",
      postRoomId: mode === "single" ? "" : id + "-post",
      createdAt: iso(),
      ready: false,
      ...(mode === "single" ? { mode: "single" as const } : {}),
    });
    // A retried request keeps the shape it was first created with.
    const single = program.mode === "single";
    if (program.company !== company || program.cohort !== cohort)
      throw new AppError(
        409,
        "This creation request was already used for another cohort.",
      );
    for (const phase of single
      ? (["pre"] as const)
      : (["pre", "post"] as const)) {
      const room: Room = {
        id: phase === "pre" ? program.preRoomId : program.postRoomId,
        programId: id,
        company,
        ...(single ? { mode: "single" as const } : {}),
        name: single
          ? "AI Productivity Assessment"
          : "AI Productivity Benchmark",
        phase,
        durationMinutes: 60,
        ownerId: host.id,
        batch: cohort,
        createdAt: program.createdAt,
        closed: phase === "post",
        scoringVersion: "corporate-all5-v2",
        optionLayout: CURRENT_OPTION_LAYOUT,
        ...(phase === "post" ? { preRoomId: program.preRoomId } : {}),
        ...(host.testAccount
          ? { dataClassification: "synthetic-test" as const }
          : {}),
      };
      await createJson(this.store, roomKey(room.id), room);
      await mutate<{ rooms: string[] }>(
        this.store,
        "hosts/" + host.id + "/rooms.json",
        (x) => ({ rooms: [...new Set([...(x?.rooms || []), room.id])] }),
      );
    }
    return mutate<Program>(this.store, key, (x) => ({ ...x!, ready: true }));
  }
  async validateJoin(roomId: string, identity: Identity) {
    if (identity.role !== "attendee")
      throw new AppError(403, "Attendee access required.");
    const room = await this.room(roomId);
    if (room.programId) {
      const program = await getJson<Program>(
        this.store,
        `programs/${room.programId}/program.json`,
      );
      if (!program?.ready)
        throw new AppError(
          409,
          "This program is still being prepared. Ask your host to retry creation.",
          "PROGRAM_PREPARING",
        );
    }
    const prior = await this.participant(roomId, identity.id);
    // Single-round release: only host-created cohort rooms accept new attendees.
    if (assessmentMode() === "single" && !room.programId && !prior)
      throw new AppError(
        404,
        "Invalid room code. Check the code with your coordinator.",
        "INVALID_ROOM",
      );
    if (prior?.submittedAt)
      throw new AppError(
        409,
        prior.submissionReason === "deadline"
          ? "This attempt has expired. View your saved results."
          : "This attempt was submitted. View your results.",
        prior.submissionReason === "deadline"
          ? "ATTEMPT_EXPIRED"
          : "ATTEMPT_SUBMITTED",
      );
    if (room.closed)
      throw new AppError(
        409,
        "This room is closed. Contact your coordinator.",
        "ROOM_CLOSED",
      );
    if (room.phase === "post") {
      const pre = await this.participant(room.preRoomId!, identity.id);
      if (
        !pre?.submittedAt ||
        pre.selected.length === 0 ||
        Object.keys(pre.taskCompletedAt).length !== pre.selected.length
      )
        throw new AppError(
          409,
          "Complete the linked Base Camp assessment first using the same verified email.",
          "PRE_REQUIRED",
        );
      if (
        (pre.scoringVersion || "legacy-100") !==
        (room.scoringVersion || "legacy-100")
      )
        throw new AppError(
          409,
          "The linked rounds use different scoring versions. Contact your coordinator.",
        );
    }
    return room;
  }
  async rooms(identity: Identity) {
    const index = await getJson<{ rooms: string[] }>(
      this.store,
      `${identity.role === "host" ? "hosts" : "attendees"}/${identity.id}/rooms.json`,
    );
    const ids = [
      ...new Set([
        ...(assessmentMode() === "single" ? [] : ["ai-productivity-pre"]),
        ...(index?.rooms || []),
      ]),
    ];
    const result = [];
    for (const id of ids) result.push(await this.room(id));
    if (identity.role === "attendee") {
      for (const pre of [...result]) {
        if (!pre.programId) continue;
        const program = await getJson<Program>(
          this.store,
          `programs/${pre.programId}/program.json`,
        );
        if (
          program?.ready &&
          program.postRoomId &&
          !result.some((r) => r.id === program.postRoomId)
        )
          result.push(await this.room(program.postRoomId));
      }
    }
    return result;
  }
  async join(roomId: string, identity: Identity) {
    if (identity.role !== "attendee")
      throw new AppError(403, "Attendee access required.");
    const room = await this.validateJoin(roomId, identity);
    const assigned =
      room.phase === "post"
        ? [...(await this.participant(room.preRoomId!, identity.id))!.selected]
        : [...TASK_IDS];
    const record: Participant = {
      identity,
      roomId,
      scoringVersion: room.scoringVersion || "legacy-100",
      selected: assigned,
      answers: {},
      notes: {},
      evidence: [],
      startedAt: new Date(this.clock()).toISOString(),
      deadline: new Date(
        this.clock() + room.durationMinutes * 60000,
      ).toISOString(),
      submittedAt: null,
      revision: 0,
      mcq: {},
      grades: {},
      taskCompletedAt: {},
      lastSeenAt: iso(),
    };
    const joined = await createJson(
      this.store,
      participantKey(roomId, identity.id),
      record,
    );
    await mutate<{ rooms: string[] }>(
      this.store,
      `attendees/${identity.id}/rooms.json`,
      (x) => ({ rooms: [...new Set([...(x?.rooms || []), roomId])] }),
    );
    if (!joined.startedAt)
      return this.edit(roomId, identity.id, (p) =>
        p.startedAt
          ? p
          : { ...p, startedAt: record.startedAt, deadline: record.deadline },
      );
    return joined;
  }
  async participant(roomId: string, id: string) {
    return this.expire(roomId, id);
  }
  private finalize(room: Room, p: Participant, reason: "manual" | "deadline") {
    const submittedAt =
      reason === "deadline"
        ? p.deadline!
        : new Date(this.clock()).toISOString();
    // No-evidence policy (single round): a selected challenge with no uploaded
    // evidence scores 0/8 practical, recorded explicitly rather than left pending.
    const absent =
      room.mode === "single"
        ? p.selected.filter(
            (t) => !p.grades[t] && !p.evidence.some((e) => e.task === t),
          )
        : [];
    const zero = (): Grade => ({
      quality: 0,
      accuracy: 0,
      completeness: 0,
      feedback:
        "No evidence was submitted for this challenge. Practical marks: 0.",
      graderId: "system",
      at: submittedAt,
      automatic: true,
    });
    return {
      ...p,
      mcq: mark(room.phase, p.answers, p.selected, layoutOf(room)),
      submittedAt,
      submissionReason: reason,
      revision: p.revision + 1,
      ...(absent.length
        ? {
            grades: {
              ...p.grades,
              ...Object.fromEntries(absent.map((t) => [t, zero()])),
            },
            gradingHistory: [
              ...(p.gradingHistory || []),
              ...absent.map((task) => ({ task, ...zero() })),
            ],
          }
        : {}),
    };
  }
  async expire(roomId: string, id: string): Promise<Participant | null> {
    const key = participantKey(roomId, id),
      p = await getJson<Participant>(this.store, key);
    if (!p) return null;
    if (
      !p.submittedAt &&
      p.deadline &&
      Date.parse(p.deadline) <= this.clock()
    ) {
      const room = await this.room(roomId);
      return mutate<Participant>(this.store, key, (old) => {
        if (!old) throw new AppError(404, "Participant missing");
        return old.submittedAt ? old : this.finalize(room, old, "deadline");
      });
    }
    return p;
  }
  private async edit(
    roomId: string,
    id: string,
    fn: (p: Participant, room: Room) => Participant,
    advanceRevision = true,
  ) {
    const room = await this.room(roomId);
    await this.expire(roomId, id);
    return mutate<Participant>(
      this.store,
      participantKey(roomId, id),
      (old) => {
        if (!old) throw new AppError(404, "Join the room first.");
        if (
          old.submittedAt ||
          (old.deadline && Date.parse(old.deadline) <= this.clock())
        )
          throw new AppError(409, "Assessment is locked.");
        if (room.closed) throw new AppError(409, "Room is closed.");
        return {
          ...fn(old, room),
          revision: old.revision + (advanceRevision ? 1 : 0),
          lastSeenAt: new Date(this.clock()).toISOString(),
        };
      },
    );
  }
  async start(roomId: string, id: string, _selected: TaskId[] = []) {
    const room = await this.room(roomId);
    let tasks: TaskId[] = [...TASK_IDS];
    if (room.phase === "post") {
      const pre = await this.participant(room.preRoomId!, id);
      if (!pre?.submittedAt || pre.selected.length === 0)
        throw new AppError(409, "A completed Pre-AI assessment is required.");
      tasks = pre.selected;
    }
    if (
      tasks.length === 0 ||
      (room.phase === "pre" && tasks.length !== TASK_IDS.length) ||
      new Set(tasks).size !== tasks.length ||
      tasks.some((x) => !TASK_IDS.includes(x))
    )
      throw new AppError(400, "All five challenges are required.");
    return this.edit(roomId, id, (p) => {
      if (p.selected.length > 0) {
        if (JSON.stringify(p.selected) !== JSON.stringify(tasks))
          throw new AppError(
            409,
            "Assigned challenges are locked after starting.",
          );
        return p;
      }
      return {
        ...p,
        selected: tasks,
        startedAt: p.startedAt || new Date(this.clock()).toISOString(),
        deadline:
          p.deadline ||
          new Date(this.clock() + room.durationMinutes * 60000).toISOString(),
      };
    });
  }
  async save(
    roomId: string,
    id: string,
    input: {
      revision: number;
      answers: Participant["answers"];
      notes: Participant["notes"];
      completed: TaskId[];
    },
  ) {
    return this.edit(roomId, id, (p) => {
      if (!p.startedAt) throw new AppError(409, "Start the assessment first.");
      if (input.revision !== p.revision)
        throw new AppError(
          409,
          "Another tab or request saved changes. Reload before editing.",
          "CONFLICT",
        );
      if (
        [
          ...Object.keys(input.answers),
          ...Object.keys(input.notes),
          ...input.completed,
        ].some((x) => !p.selected.includes(x as TaskId))
      )
        throw new AppError(400, "Only assigned challenges may be changed.");
      const complete: Participant["taskCompletedAt"] = {};
      for (const task of input.completed) {
        if (
          input.answers[task]?.length !== 4 ||
          input.answers[task]?.some((x) => x < 0) ||
          !p.evidence.some((x) => x.task === task)
        )
          throw new AppError(
            400,
            "Answer all four questions and attach evidence before marking a task complete.",
          );
        complete[task] =
          p.taskCompletedAt[task] || new Date(this.clock()).toISOString();
      }
      const now = new Date(this.clock()).toISOString();
      const answerSavedAt: NonNullable<Participant["answerSavedAt"]> = {};
      for (const task of Object.keys(input.answers) as TaskId[])
        answerSavedAt[task] = (input.answers[task] || []).map((a, i) =>
          a < 0
            ? null
            : p.answers[task]?.[i] === a
              ? (p.answerSavedAt?.[task]?.[i] ?? now)
              : now,
        );
      return {
        ...p,
        answers: input.answers,
        answerSavedAt,
        notes: input.notes,
        taskCompletedAt: complete,
      };
    });
  }
  async submit(roomId: string, id: string) {
    const prior = await this.expire(roomId, id);
    if (prior?.submittedAt) return prior;
    const room = await this.room(roomId);
    return mutate<Participant>(this.store, participantKey(roomId, id), (p) => {
      if (!p) throw new AppError(404, "Join the room first.");
      if (p.submittedAt) return p;
      if (p.deadline && Date.parse(p.deadline) <= this.clock())
        return this.finalize(room, p, "deadline");
      if (
        p.selected.length === 0 ||
        p.selected.some((x) => !p.taskCompletedAt[x])
      )
        throw new AppError(
          400,
          "Complete all five challenges before submitting.",
        );
      return this.finalize(room, p, "manual");
    });
  }
  async upload(
    roomId: string,
    id: string,
    task: TaskId,
    name: string,
    data: Buffer,
    committedPath?: string,
  ) {
    if (!data.length || data.length > evidenceLimitMB() * 1024 * 1024)
      throw new AppError(
        400,
        `Upload a nonempty file up to ${evidenceLimitMB()} MB.`,
      );
    const ext = name.split(".").pop()?.toLowerCase();
    if (
      ![
        "xlsx",
        "docx",
        "pptx",
        "pdf",
        "csv",
        "txt",
        "png",
        "jpg",
        "jpeg",
      ].includes(ext || "")
    )
      throw new AppError(400, "Unsupported evidence file type.");
    if (
      ["xlsx", "docx", "pptx"].includes(ext!) &&
      data.subarray(0, 2).toString() !== "PK"
    )
      throw new AppError(
        400,
        "Office evidence must be a valid Office Open XML file.",
      );
    if (ext === "pdf" && data.subarray(0, 5).toString() !== "%PDF-")
      throw new AppError(400, "Invalid PDF header.");
    const p = await this.participant(roomId, id);
    if (!p || p.submittedAt || !p.startedAt || !p.selected.includes(task))
      throw new AppError(
        409,
        "Evidence uploads are locked or task not selected.",
      );
    const hash = createHash("sha256").update(data).digest("hex"),
      evidenceId = hash + "-" + task;
    const existing = p.evidence.find((x) => x.id === evidenceId);
    if (existing) return p;
    const key = `rooms/${roomId}/evidence/${id}/${evidenceId}.${ext}`;
    await createJson(
      this.store,
      `rooms/${roomId}/upload-intents/${randomUUID()}.json`,
      { path: key, participantId: id, at: iso() },
    );
    // Direct SharePoint uploads store the same name with ".bin" appended.
    if (
      committedPath &&
      committedPath !== key &&
      committedPath !== key + ".bin"
    )
      throw new AppError(400, "Uploaded evidence path mismatch");
    // A direct upload has already been read and verified by the resumable finalizer.
    if (!committedPath)
      try {
        await this.store.write(key, data, null);
      } catch (e) {
        const stored = await this.store.read(key);
        if (
          !stored ||
          createHash("sha256").update(stored.data).digest("hex") !== hash
        )
          throw e;
      }
    return this.edit(roomId, id, (current) => {
      if (current.evidence.some((x) => x.id === evidenceId)) return current;
      if (current.evidence.length >= 15)
        throw new AppError(400, "Maximum 15 evidence files per assessment.");
      return {
        ...current,
        evidence: [
          ...current.evidence,
          {
            id: evidenceId,
            task,
            name: name.replace(/[^a-zA-Z0-9_. -]/g, "_").slice(0, 100),
            size: data.length,
            sha256: hash,
            // The path actually written (direct uploads add ".bin").
            path: committedPath || key,
            uploadedAt: iso(),
            contentType: "application/octet-stream",
          },
        ],
      };
    });
  }
  async reserveUpload(
    roomId: string,
    id: string,
    task: TaskId,
    uploadId: string,
  ) {
    return this.edit(
      roomId,
      id,
      (p) => {
        if (!p.startedAt || !p.selected.includes(task))
          throw new AppError(409, "Select this challenge before uploading");
        const reservations = p.uploadReservations || [];
        if (!reservations.includes(uploadId) && reservations.length >= 15)
          throw new AppError(
            400,
            "Maximum 15 distinct upload reservations per assessment",
          );
        return {
          ...p,
          uploadReservations: [...new Set([...reservations, uploadId])],
        };
      },
      false,
    );
  }
  async attendees(roomId: string, host: Identity) {
    this.assertHost(await this.room(roomId), host);
    const files = await this.store.list(`rooms/${roomId}/participants`);
    const result: Participant[] = [];
    for (const key of files.filter((x) => x.endsWith(".json"))) {
      const id = key.split("/").pop()!.slice(0, -5);
      const p = await this.participant(roomId, id);
      if (p) result.push(p);
    }
    return result;
  }
  async grade(
    roomId: string,
    id: string,
    task: TaskId,
    host: Identity,
    grade: Omit<Grade, "at" | "graderId">,
    expectedAt?: string | null,
  ) {
    this.assertHost(await this.room(roomId), host);
    return mutate<Participant>(this.store, participantKey(roomId, id), (p) => {
      if (!p?.submittedAt || !p.selected.includes(task))
        throw new AppError(409, "Submit this assessment before evaluation.");
      if (
        expectedAt !== undefined &&
        (p.grades[task]?.at ?? null) !== expectedAt
      )
        throw new AppError(
          409,
          "This evaluation changed. Close and reopen it before saving.",
        );
      const limits =
        p.scoringVersion === "corporate-60-v1" ||
        p.scoringVersion === "corporate-all5-v2"
          ? { quality: 2, accuracy: 3, completeness: 3 }
          : { quality: 5, accuracy: 5, completeness: 5 };
      for (const k of ["quality", "accuracy", "completeness"] as const)
        if (!Number.isInteger(grade[k]) || grade[k] < 0 || grade[k] > limits[k])
          throw new AppError(
            400,
            "Practical marks exceed the scoring-version rubric.",
          );
      const at = new Date(
        Math.max(
          Date.now(),
          p.grades[task] ? Date.parse(p.grades[task]!.at) + 1 : 0,
        ),
      ).toISOString();
      const event = { ...grade, graderId: host.id, at };
      return {
        ...p,
        revision: p.revision + 1,
        grades: { ...p.grades, [task]: event },
        gradingHistory: [...(p.gradingHistory || []), { task, ...event }],
      };
    });
  }
  async close(roomId: string, host: Identity, closed: boolean) {
    this.assertHost(await this.room(roomId), host);
    const room = await mutate<Room>(this.store, roomKey(roomId), (r) => {
      if (!r) throw new AppError(404, "Room missing");
      return { ...r, closed };
    });
    roomCacheFor(this.store).set(roomId, {
      room,
      until: Date.now() + ROOM_TTL_MS,
    });
    return room;
  }
}
export { comparison, metrics } from "./metrics";
