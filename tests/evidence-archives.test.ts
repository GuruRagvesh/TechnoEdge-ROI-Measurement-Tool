import { it, expect } from "vitest";
import { AssessmentService, participantKey } from "../src/lib/assessment";
import {
  createEvidenceArchivePlan,
  readEvidenceArchivePart,
  splitEvidence,
} from "../src/lib/evidence-archives";
import { mutate } from "../src/lib/storage";
import { MemoryStorage, attendee, host } from "./helpers";
import type { Participant, Evidence } from "../src/lib/types";
it("splits large cohort evidence into immutable, host-scoped parts bounded to 100 MiB", async () => {
  const store = new MemoryStorage(),
    service = new AssessmentService(store),
    program = await service.createProgram(
      host,
      "Orion",
      "Archive parts",
      crypto.randomUUID(),
    );
  const room = await service.room(program.preRoomId);
  await service.join(room.id, attendee);
  const files: Evidence[] = Array.from({ length: 9 }, (_, i) => ({
    id: "file" + i,
    task: "inbox",
    name: `review-${i}.pptx`,
    size: 25 * 1024 * 1024,
    sha256: "a".repeat(64),
    path: `rooms/${room.id}/evidence/${attendee.id}/file-${i}.pptx`,
    uploadedAt: new Date().toISOString(),
    contentType: "application/octet-stream",
  }));
  await mutate<Participant>(
    store,
    participantKey(room.id, attendee.id),
    (p) => ({ ...p!, evidence: files }),
  );
  const plan = await createEvidenceArchivePlan(service, room, host);
  expect(plan.parts).toHaveLength(3);
  expect(plan.parts.flat()).toHaveLength(9);
  for (const part of plan.parts)
    expect(part.reduce((n, x) => n + x.e.size, 0)).toBeLessThanOrEqual(
      100 * 1024 * 1024,
    );
  await mutate<Participant>(
    store,
    participantKey(room.id, attendee.id),
    (p) => ({ ...p!, evidence: [] }),
  );
  expect(
    await readEvidenceArchivePart(service, room, host, plan.id, 1),
  ).toHaveLength(4);
  await expect(
    readEvidenceArchivePart(
      service,
      room,
      { ...host, id: "other" },
      plan.id,
      1,
    ),
  ).rejects.toThrow("cannot manage");
  await expect(
    readEvidenceArchivePart(service, room, attendee, plan.id, 1),
  ).rejects.toThrow();
  await expect(
    readEvidenceArchivePart(service, room, host, plan.id, 4),
  ).rejects.toThrow("not found");
});
it("does not silently omit a file too large for a bounded archive part", () => {
  expect(() =>
    splitEvidence(
      [{ participant: { id: "a", name: "A" }, e: { size: 101 } as Evidence }],
      100,
    ),
  ).toThrow("individually");
});
