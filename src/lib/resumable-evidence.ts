import { createHash, randomUUID } from "node:crypto";
import { AssessmentService } from "./assessment";
import { createJson, getJson, mutate, type Storage } from "./storage";
import { evidenceLimitMB } from "./config";
import { AppError, type Identity, type TaskId } from "./types";
export type DirectSession = { uploadUrl: string; expiresAt: string };
export interface DirectUploadBackend {
  createEvidenceSession(path: string): Promise<DirectSession>;
  evidenceSessionStatus(
    url: string,
  ): Promise<{ offset: number; expiresAt?: string } | null>;
  evidenceFileSize(path: string): Promise<number | null>;
  cancelEvidenceSession(url: string): Promise<void>;
}
type Intent = {
  id: string;
  participantId: string;
  roomId: string;
  task: TaskId;
  name: string;
  path: string;
  size: number;
  sha256: string;
  createdAt: string;
  session?: DirectSession;
  lease?: string;
  leaseUntil?: number;
  completedAt?: string;
};
export type UploadDescription = {
  task: TaskId;
  name: string;
  size: number;
  sha256: string;
};
export class ResumableEvidence {
  constructor(
    private store: Storage,
    private backend: DirectUploadBackend,
    private clock = () => Date.now(),
  ) {}
  private service() {
    return new AssessmentService(this.store, this.clock);
  }
  private key(room: string, person: string, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new AppError(400, "Invalid upload identifier");
    return `rooms/${room}/resumable-intents/${person}/${id}.json`;
  }
  private async active(room: string, identity: Identity, task?: TaskId) {
    if (identity.role !== "attendee")
      throw new AppError(403, "Attendee access required");
    const r = await this.service().room(room),
      p = await this.service().participant(room, identity.id);
    if (
      !p ||
      p.submittedAt ||
      !p.startedAt ||
      !p.deadline ||
      Date.parse(p.deadline) <= this.clock() ||
      r.closed
    )
      throw new AppError(409, "Evidence uploads are locked", "ATTEMPT_LOCKED");
    if (task && !p.selected.includes(task))
      throw new AppError(403, "This challenge is not selected");
    return p;
  }
  private async intent(room: string, who: Identity, id: string) {
    if (who.role !== "attendee")
      throw new AppError(403, "Attendee access required");
    const intent = await getJson<Intent>(
      this.store,
      this.key(room, who.id, id),
    );
    if (!intent || intent.roomId !== room || intent.participantId !== who.id)
      throw new AppError(404, "Upload not found");
    return intent;
  }
  async begin(room: string, who: Identity, input: UploadDescription) {
    const participant = await this.active(room, who, input.task);
    const ext = input.name.split(".").pop()?.toLowerCase();
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
      ].includes(ext || "") ||
      !input.name.length ||
      input.name.length > 100
    )
      throw new AppError(400, "Unsupported evidence filename");
    if (
      !Number.isInteger(input.size) ||
      input.size < 1 ||
      input.size > evidenceLimitMB() * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(input.sha256)
    )
      throw new AppError(
        400,
        `Upload a file up to ${evidenceLimitMB()} MiB with a valid checksum`,
      );
    const id = createHash("sha256")
      .update(who.id + ":" + input.task + ":" + input.sha256 + ":" + ext)
      .digest("hex");
    const key = this.key(room, who.id, id),
      path = `rooms/${room}/evidence/${who.id}/${input.sha256}-${input.task}.${ext}`;
    // Reserve one bounded, durable slot. Re-selecting this same file reuses the slot and session.
    await this.service().reserveUpload(room, who.id, input.task, id);
    let current = await createJson<Intent>(this.store, key, {
      ...input,
      id,
      path,
      roomId: room,
      participantId: who.id,
      createdAt: new Date(this.clock()).toISOString(),
    });
    if (current.size !== input.size || current.sha256 !== input.sha256)
      throw new AppError(409, "Upload metadata changed");
    const size = await this.backend.evidenceFileSize(path);
    if (size !== null) {
      if (size !== input.size)
        throw new AppError(
          409,
          "Committed file size does not match the upload",
        );
      return {
        uploadId: id,
        committed: true,
        offset: size,
        deadline: participant.deadline,
      };
    }
    if (
      current.session &&
      Date.parse(current.session.expiresAt) > this.clock()
    ) {
      const status = await this.backend.evidenceSessionStatus(
        current.session.uploadUrl,
      );
      if (status) {
        if (status.offset < 0 || status.offset > input.size)
          throw new AppError(409, "Invalid upload offset");
        await this.active(room, who, input.task);
        return {
          uploadId: id,
          committed: false,
          offset: status.offset,
          uploadUrl: current.session.uploadUrl,
          deadline: participant.deadline,
        };
      }
    }
    const lease = randomUUID();
    await mutate<Intent>(this.store, key, (old) => {
      if (!old) throw new AppError(404, "Upload missing");
      if (old.leaseUntil && old.leaseUntil > this.clock())
        throw new AppError(
          409,
          "Upload session is being prepared; retry shortly",
        );
      return { ...old, lease, leaseUntil: this.clock() + 60000 };
    });
    try {
      const session = await this.backend.createEvidenceSession(path);
      if (
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= this.clock()
      )
        throw new AppError(503, "Invalid upload-session expiry");
      current = await mutate<Intent>(this.store, key, (old) => {
        if (!old || old.lease !== lease)
          throw new AppError(409, "Upload preparation changed; retry");
        return { ...old, session, lease: undefined, leaseUntil: undefined };
      });
      await this.active(room, who, input.task);
      return {
        uploadId: id,
        committed: false,
        offset: 0,
        uploadUrl: current.session!.uploadUrl,
        deadline: participant.deadline,
      };
    } catch (e) {
      await mutate<Intent>(this.store, key, (old) =>
        old?.lease === lease
          ? { ...old, lease: undefined, leaseUntil: undefined }
          : old!,
      );
      throw e;
    }
  }
  async status(room: string, who: Identity, id: string) {
    const intent = await this.intent(room, who, id);
    await this.active(room, who, intent.task);
    const size = await this.backend.evidenceFileSize(intent.path);
    if (size !== null) {
      if (size !== intent.size)
        throw new AppError(409, "Uploaded size mismatch");
      return { committed: true, offset: size };
    }
    if (!intent.session)
      throw new AppError(
        409,
        "Select the same file to prepare the upload session",
      );
    const status = await this.backend.evidenceSessionStatus(
      intent.session.uploadUrl,
    );
    if (!status)
      throw new AppError(
        409,
        "Upload session expired. Select the same file to restart safely.",
      );
    if (status.offset < 0 || status.offset > intent.size)
      throw new AppError(409, "Uploaded size mismatch");
    return { committed: false, offset: status.offset };
  }
  async complete(room: string, who: Identity, id: string) {
    const intent = await this.intent(room, who, id),
      existing = await this.service().participant(room, who.id);
    // Lost response/repeated finalization returns the same receipt without unlocking an attempt.
    if (
      existing?.evidence.some(
        (e) => e.path === intent.path && e.sha256 === intent.sha256,
      )
    )
      return existing;
    await this.active(room, who, intent.task);
    if (
      intent.size > evidenceLimitMB() * 1024 * 1024 ||
      (await this.backend.evidenceFileSize(intent.path)) !== intent.size
    )
      throw new AppError(400, "Upload is incomplete or exceeds the file limit");
    const blob = await this.store.read(intent.path);
    if (
      !blob ||
      blob.data.length !== intent.size ||
      createHash("sha256").update(blob.data).digest("hex") !== intent.sha256
    )
      throw new AppError(
        400,
        "Evidence checksum mismatch; file was not attached",
      );
    const participant = await this.service().upload(
      room,
      who.id,
      intent.task,
      intent.name,
      blob.data,
      intent.path,
    );
    await mutate<Intent>(this.store, this.key(room, who.id, id), (old) => ({
      ...old!,
      completedAt: new Date(this.clock()).toISOString(),
    }));
    return participant;
  }
  async cancel(room: string, who: Identity, id: string) {
    const intent = await this.intent(room, who, id);
    if (intent.completedAt) return;
    if (intent.session)
      await this.backend.cancelEvidenceSession(intent.session.uploadUrl);
    await mutate<Intent>(this.store, this.key(room, who.id, id), (old) => ({
      ...old!,
      session: undefined,
      lease: undefined,
      leaseUntil: undefined,
    }));
  }
}
