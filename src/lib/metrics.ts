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
