import { randomUUID } from "node:crypto";
import type { AssessmentService } from "./assessment";
import type { EvidenceSnapshot } from "./reports";
import { createJson, getJson } from "./storage";
import { AppError, type Identity, type Room } from "./types";
type ArchivePlan = {
  roomId: string;
  ownerId: string;
  createdAt: string;
  parts: EvidenceSnapshot[][];
};
export function splitEvidence(
  files: EvidenceSnapshot[],
  limit = 100 * 1024 * 1024,
) {
  const parts: EvidenceSnapshot[][] = [[]];
  let size = 0;
  for (const file of files) {
    if (file.e.size > limit)
      throw new AppError(
        413,
        "A file exceeds archive-part capacity. Download that evidence individually.",
      );
    if (size + file.e.size > limit) {
      parts.push([]);
      size = 0;
    }
    parts.at(-1)!.push(file);
    size += file.e.size;
  }
  return parts;
}
export async function createEvidenceArchivePlan(
  service: AssessmentService,
  room: Room,
  host: Identity,
) {
  service.assertHost(room, host);
  const people = await service.attendees(room.id, host);
  const files = people.flatMap((p) =>
    p.evidence.map((e) => ({
      participant: {
        id: p.identity.id,
        name: p.identity.name,
        ...(p.identity.testAccount ? { testAccount: true as const } : {}),
      },
      e,
    })),
  );
  const id = randomUUID(),
    plan: ArchivePlan = {
      roomId: room.id,
      ownerId: host.id,
      createdAt: new Date().toISOString(),
      parts: splitEvidence(files),
    };
  await createJson(
    service.store,
    `rooms/${room.id}/reports/${id}-evidence-plan.json`,
    plan,
  );
  return { id, ...plan };
}
export async function readEvidenceArchivePart(
  service: AssessmentService,
  room: Room,
  host: Identity,
  id: string,
  part: number,
) {
  service.assertHost(room, host);
  if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isInteger(part) || part < 1)
    throw new AppError(400, "Invalid archive part");
  const plan = await getJson<ArchivePlan>(
    service.store,
    `rooms/${room.id}/reports/${id}-evidence-plan.json`,
  );
  if (
    !plan ||
    plan.roomId !== room.id ||
    plan.ownerId !== host.id ||
    !plan.parts[part - 1]
  )
    throw new AppError(404, "Archive part not found");
  return plan.parts[part - 1];
}
