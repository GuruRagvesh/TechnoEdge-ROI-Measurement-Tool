import type { Participant, Grade } from "./types";
export function metrics(p: Participant) {
  const corporate = p.scoringVersion === "corporate-60-v1";
  const mcq = p.selected.reduce((n, id) => n + (p.mcq[id] || 0), 0),
    graded = p.selected.map((id) => p.grades[id]).filter(Boolean) as Grade[];
  const practical = graded.reduce(
      (s, g) => s + g.quality + g.accuracy + g.completeness,
      0,
    ),
    fullyGraded = p.selected.length === 3 && graded.length === 3;
  return {
    scoringVersion: p.scoringVersion || "legacy-100",
    maximum: corporate ? 60 : 100,
    mcqMarks: corporate ? mcq * 3 : mcq,
    mcq,
    accuracy: p.submittedAt ? (mcq / 12) * 100 : null,
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
          : Math.round((mcq / 12) * 40 + (practical / 45) * 60)
        : null,
    completed: Object.keys(p.taskCompletedAt).length,
    minutes:
      p.startedAt && p.submittedAt
        ? (Date.parse(p.submittedAt) - Date.parse(p.startedAt)) / 60000
        : null,
  };
}
// Pre/Post rule: same person, same scoring model, same three challenges,
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
    pre.selected.length === 3 &&
    pre.selected.every((t) => post.selected.includes(t)) &&
    a.completed === 3 &&
    b.completed === 3 &&
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
