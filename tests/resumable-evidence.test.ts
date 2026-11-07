import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { AssessmentService } from "../src/lib/assessment";
import {
  ResumableEvidence,
  type DirectUploadBackend,
} from "../src/lib/resumable-evidence";
import { MemoryStorage, attendee, host } from "./helpers";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
class Backend implements DirectUploadBackend {
  sessions = new Map<string, { path: string; offset: number }>();
  created = 0;
  constructor(public store: MemoryStorage) {}
  async createEvidenceSession(path: string) {
    this.created++;
    const uploadUrl = "https://test.up.1drv.com/" + randomUUID();
    this.sessions.set(uploadUrl, { path, offset: 0 });
    return {
      uploadUrl,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
  }
  async evidenceSessionStatus(url: string) {
    const s = this.sessions.get(url);
    return s ? { offset: s.offset } : null;
  }
  async evidenceFileSize(path: string) {
    return (await this.store.read(path))?.data.length ?? null;
  }
  async cancelEvidenceSession(url: string) {
    this.sessions.delete(url);
  }
  async commit(url: string, data: Buffer) {
    const s = this.sessions.get(url)!;
    await this.store.write(s.path, data, null);
    this.sessions.delete(url);
  }
}
describe("authorized durable direct-upload intents", () => {
  let store: MemoryStorage,
    backend: Backend,
    service: AssessmentService,
    uploads: ResumableEvidence,
    now: number;
  const room = "ai-productivity-pre";
  const data = Buffer.from("Customer,Revenue\nOrion,12345");
  const input = () => ({
    task: "inbox" as const,
    name: "analysis.csv",
    size: data.length,
    sha256: sha(data),
  });
  beforeEach(async () => {
    store = new MemoryStorage();
    backend = new Backend(store);
    now = Date.now();
    service = new AssessmentService(store, () => now);
    uploads = new ResumableEvidence(store, backend, () => now);
    await service.defaultRoom();
    await service.join(room, attendee);
    await service.start(room, attendee.id, ["inbox", "dashboard", "mbr"]);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("resumes the same session after a server/service restart without changing answer revisions", async () => {
    const revision = (await service.participant(room, attendee.id))!.revision;
    const a = await uploads.begin(room, attendee, input());
    backend.sessions.get(a.uploadUrl!)!.offset = 10;
    const b = await new ResumableEvidence(store, backend, () => now).begin(
      room,
      attendee,
      input(),
    );
    expect(b).toMatchObject({
      uploadId: a.uploadId,
      uploadUrl: a.uploadUrl,
      offset: 10,
    });
    expect(backend.created).toBe(1);
    expect((await service.participant(room, attendee.id))!.revision).toBe(
      revision,
    );
  });
  it("verifies and attaches only committed checksum-matching evidence; duplicate completion is idempotent", async () => {
    const a = await uploads.begin(room, attendee, input());
    await expect(uploads.complete(room, attendee, a.uploadId)).rejects.toThrow(
      "incomplete",
    );
    await backend.commit(a.uploadUrl!, data);
    const p = await uploads.complete(room, attendee, a.uploadId);
    expect(p.evidence).toHaveLength(1);
    expect(p.evidence[0].sha256).toBe(sha(data));
    const again = await new ResumableEvidence(
      store,
      backend,
      () => now,
    ).complete(room, attendee, a.uploadId);
    expect(again.revision).toBe(p.revision);
    expect(again.evidence).toEqual(p.evidence);
  });
  it("rejects other participants, hosts, other rooms, unselected tasks and supplied path injection", async () => {
    const a = await uploads.begin(room, attendee, input());
    await expect(
      uploads.complete(room, { ...attendee, id: "other" }, a.uploadId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(uploads.begin(room, host, input())).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      uploads.begin(room, attendee, { ...input(), task: "clean" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      uploads.complete("other-room", attendee, a.uploadId),
    ).rejects.toMatchObject({ status: 404 });
    const intents = [...store.files.keys()].filter((k) =>
      k.includes("resumable-intents"),
    );
    expect(JSON.parse(store.files.get(intents[0])!.data.toString()).path).toBe(
      `rooms/${room}/evidence/${attendee.id}/${sha(data)}-inbox.csv`,
    );
  });
  it("rejects uploads over 25 MiB before issuing a Microsoft session", async () => {
    await expect(
      uploads.begin(room, attendee, { ...input(), size: 25 * 1024 * 1024 + 1 }),
    ).rejects.toThrow("25 MiB");
    expect(backend.created).toBe(0);
    vi.stubEnv("EVIDENCE_MAX_MIB", "30");
    expect(
      await uploads.begin(room, attendee, {
        ...input(),
        size: 26 * 1024 * 1024,
      }),
    ).toHaveProperty("uploadId");
  });
  it("rejects a committed oversize or corrupted file before attaching it", async () => {
    const a = await uploads.begin(room, attendee, input());
    await backend.commit(a.uploadUrl!, Buffer.alloc(data.length, 1));
    await expect(uploads.complete(room, attendee, a.uploadId)).rejects.toThrow(
      "checksum",
    );
    expect(
      (await service.participant(room, attendee.id))!.evidence,
    ).toHaveLength(0);
  });
  it("rejects completion and status after the server deadline even if Microsoft accepted the bytes", async () => {
    const a = await uploads.begin(room, attendee, input());
    await backend.commit(a.uploadUrl!, data);
    now = Date.parse((await service.participant(room, attendee.id))!.deadline!);
    await expect(
      uploads.complete(room, attendee, a.uploadId),
    ).rejects.toMatchObject({ code: "ATTEMPT_LOCKED" });
    await expect(
      uploads.status(room, attendee, a.uploadId),
    ).rejects.toMatchObject({ code: "ATTEMPT_LOCKED" });
    expect(
      (await service.participant(room, attendee.id))!.evidence,
    ).toHaveLength(0);
  });
  it("restarts an expired Microsoft session and cancels only the owner's scoped session", async () => {
    const a = await uploads.begin(room, attendee, input());
    backend.sessions.delete(a.uploadUrl!);
    const b = await uploads.begin(room, attendee, input());
    expect(b.uploadUrl).not.toBe(a.uploadUrl);
    expect(b.uploadId).toBe(a.uploadId);
    await expect(
      uploads.cancel(room, { ...attendee, id: "other" }, b.uploadId),
    ).rejects.toMatchObject({ status: 404 });
    await uploads.cancel(room, attendee, b.uploadId);
    expect(backend.sessions.has(b.uploadUrl!)).toBe(false);
  });
  it("does not attach a pending upload after manual submission", async () => {
    const pending = await uploads.begin(room, attendee, input());
    let p = (await service.participant(room, attendee.id))!;
    for (const task of ["inbox", "dashboard", "mbr"] as const)
      p = await service.upload(
        room,
        attendee.id,
        task,
        "prior.csv",
        Buffer.from("Prior,Result\n1,2"),
      );
    await service.save(room, attendee.id, {
      revision: p.revision,
      answers: {
        inbox: [0, 0, 0, 0],
        dashboard: [0, 0, 0, 0],
        mbr: [0, 0, 0, 0],
      },
      notes: {},
      completed: ["inbox", "dashboard", "mbr"],
    });
    await service.submit(room, attendee.id);
    await backend.commit(pending.uploadUrl!, data);
    await expect(
      uploads.complete(room, attendee, pending.uploadId),
    ).rejects.toMatchObject({ code: "ATTEMPT_LOCKED" });
    expect(
      (await service.participant(room, attendee.id))!.evidence,
    ).toHaveLength(3);
  });
  it("rejects finalization after the host closes the room", async () => {
    const a = await uploads.begin(room, attendee, input());
    await backend.commit(a.uploadUrl!, data);
    await service.close(room, host, true);
    await expect(
      uploads.complete(room, attendee, a.uploadId),
    ).rejects.toMatchObject({ code: "ATTEMPT_LOCKED" });
  });
  it("recovers a committed blob after the participant receipt write fails", async () => {
    const a = await uploads.begin(room, attendee, input());
    await backend.commit(a.uploadUrl!, data);
    const write = store.write.bind(store);
    let failed = false;
    store.write = async (...args) => {
      if (!failed && args[0].includes("/participants/")) {
        failed = true;
        throw new Error("Injected receipt outage");
      }
      return write(...args);
    };
    await expect(uploads.complete(room, attendee, a.uploadId)).rejects.toThrow(
      "outage",
    );
    store.write = write;
    const b = await new ResumableEvidence(store, backend, () => now).begin(
      room,
      attendee,
      input(),
    );
    expect(b.committed).toBe(true);
    expect(
      (await uploads.complete(room, attendee, a.uploadId)).evidence,
    ).toHaveLength(1);
  });
  it("bounds distinct reservations but reselecting an existing file can still resume", async () => {
    const a = await uploads.begin(room, attendee, input());
    for (let i = 1; i < 15; i++)
      await uploads.begin(room, attendee, {
        ...input(),
        sha256: sha(Buffer.from(String(i))),
      });
    await expect(
      uploads.begin(room, attendee, {
        ...input(),
        sha256: sha(Buffer.from("extra")),
      }),
    ).rejects.toThrow("15 distinct");
    expect((await uploads.begin(room, attendee, input())).uploadId).toBe(
      a.uploadId,
    );
  });
});
