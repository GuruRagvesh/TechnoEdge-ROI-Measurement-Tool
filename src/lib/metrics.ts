import type { Participant, Grade } from "./types";
export function metrics(p: Participant) {
  const corporate =
    p.scoringVersion === "corporate-60-v1" ||
    p.scoringVersion === "corporate-all5-v2";
  const challengeCount = p.selected.length;
  const mcq = p.selected.reduce((n, id) => n + (p.mcq[id] || 0), 0),
    graded = p.selected.map((id) => p.grades[id]).filter(Boolean) as Grade[];
  const practical = graded.reduce(
      (s, g) => s + g.quality + g.accuracy + g.completeness,
      0,
    ),
    fullyGraded = challengeCount > 0 && graded.length === challengeCount;
  return {
    scoringVersion: p.scoringVersion || "legacy-100",
    maximum: corporate ? challengeCount * 20 : 100,
    mcqMarks: corporate ? mcq * 3 : mcq,
    mcq,
    accuracy:
      p.submittedAt && challengeCount
        ? (mcq / (challengeCount * 4)) * 100
        : null,
    quality: graded.length
      ? (graded.reduce((n, g) => n + g.quality, 0) / graded.length) *
        (corporate ? 50 : 20)
      : null,
    practical,
    fullyGraded,
    score:
      p.submittedAt && fullyGraded
        ? corporate
          ? mcq * 3 + practical
          : Math.round(
              (mcq / (challengeCount * 4)) * 40 +
                (practical / (challengeCount * 15)) * 60,
            )
        : null,
    completed: Object.keys(p.taskCompletedAt).length,
    minutes:
      p.startedAt && p.submittedAt
        ? (Date.parse(p.submittedAt) - Date.parse(p.startedAt)) / 60000
        : null,
  };
}
// Pre/Post rule: same person, same scoring model, same assigned challenges,
// both submitted, completed and fully evaluated.
export function comparison(pre: Participant, post: Participant) {
  const a = metrics(pre),
    b = metrics(post);
  const comparable =
    (pre.scoringVersion || "legacy-100") ===
      (post.scoringVersion || "legacy-100") &&
    pre.identity.id === post.identity.id &&
    !!pre.submittedAt &&
    !!post.submittedAt &&
    pre.selected.length > 0 &&
    pre.selected.length === post.selected.length &&
    pre.selected.every((t) => post.selected.includes(t)) &&
    a.completed === pre.selected.length &&
    b.completed === post.selected.length &&
    a.fullyGraded &&
    b.fullyGraded;
  const minutesSaved =
    comparable && a.minutes !== null && b.minutes !== null
      ? a.minutes - b.minutes
      : null;
  return {
    comparable,
    minutesSaved,
    timeReduction:
      minutesSaved !== null && a.minutes! > 0
        ? (minutesSaved / a.minutes!) * 100
        : null,
    scoreDelta: comparable ? b.score! - a.score! : null,
    accuracyDelta: comparable ? b.accuracy! - a.accuracy! : null,
    qualityDelta: comparable ? b.quality! - a.quality! : null,
  };
}
