import { AssessmentService, comparison, metrics } from "./assessment";
import type { Identity } from "./types";
export type BatchSummary = {
  batch: string;
  rooms: number;
  attendees: number;
  preSubmitted: number;
  postSubmitted: number;
  eligiblePairs: number;
  meanTimeReduction: number | null;
  meanAccuracyDelta: number | null;
  meanQualityDelta: number | null;
};
export async function batchSummary(
  service: AssessmentService,
  host: Identity,
): Promise<BatchSummary[]> {
  const rooms = await service.rooms(host),
    groups = new Map<
      string,
      {
        summary: BatchSummary;
        identities: Set<string>;
        changes: ReturnType<typeof comparison>[];
      }
    >();
  for (const room of rooms) {
    let group = groups.get(room.batch);
    if (!group) {
      group = {
        summary: {
          batch: room.batch,
          rooms: 0,
          attendees: 0,
          preSubmitted: 0,
          postSubmitted: 0,
          eligiblePairs: 0,
          meanTimeReduction: null,
          meanAccuracyDelta: null,
          meanQualityDelta: null,
        },
        identities: new Set(),
        changes: [],
      };
      groups.set(room.batch, group);
    }
    group.summary.rooms++;
    for (const p of await service.attendees(room.id, host)) {
      group.identities.add(p.identity.id);
      if (p.submittedAt) {
        if (room.phase === "pre") group.summary.preSubmitted++;
        else group.summary.postSubmitted++;
      }
      if (room.phase === "post" && room.preRoomId) {
        const pre = await service.participant(room.preRoomId, p.identity.id);
        if (pre) {
          const c = comparison(pre, p);
          if (c.comparable) group.changes.push(c);
        }
      }
    }
  }
  return [...groups.values()].map((g) => {
    const n = g.changes.length;
    return {
      ...g.summary,
      attendees: g.identities.size,
      eligiblePairs: n,
      meanTimeReduction: n
        ? g.changes.reduce((s, c) => s + (c.timeReduction || 0), 0) / n
        : null,
      meanAccuracyDelta: n
        ? g.changes.reduce((s, c) => s + (c.accuracyDelta || 0), 0) / n
        : null,
      meanQualityDelta: n
        ? g.changes.reduce((s, c) => s + (c.qualityDelta || 0), 0) / n
        : null,
    };
  });
}
