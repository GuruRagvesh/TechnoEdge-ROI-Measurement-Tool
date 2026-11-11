// Host dashboard aggregates. Pure functions over the participant records the
// host API returns from storage; nothing here is estimated or invented.
import { metrics } from "./metrics";
import type { Participant, Room, TaskId } from "./types";

export type QuestionStats = Partial<
  Record<TaskId, { answered: number; correct: number }[]>
>;
export type RoomRecords = {
  room: Room;
  participants: Participant[];
  questionStats?: QuestionStats;
};
export type AttemptStatus = "In progress" | "Awaiting evaluation" | "Evaluated";
export type StatusFilter = "all" | AttemptStatus | "Ended at deadline";
export type Filters = { roomId: string; status: StatusFilter };

export const TASK_ORDER: TaskId[] = [
  "inbox",
  "tables",
  "clean",
  "dashboard",
  "mbr",
];
export const TASK_SHORT: Record<TaskId, string> = {
  inbox: "Inbox Inferno",
  tables: "Hundred-Table",
  clean: "Dirty Data",
  dashboard: "Dashboard",
  mbr: "MBR Deadline",
};

export const statusOf = (p: Participant): AttemptStatus =>
  !p.submittedAt
    ? "In progress"
    : metrics(p).fullyGraded
      ? "Evaluated"
      : "Awaiting evaluation";

const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const round1 = (x: number | null) =>
  x === null ? null : Math.round(x * 10) / 10;

export type Row = {
  participant: Participant;
  room: Room;
  status: AttemptStatus;
  score: number | null;
  minutes: number | null;
};

export function rowsFor(data: RoomRecords[], filters: Filters): Row[] {
  return data
    .filter((d) => filters.roomId === "all" || d.room.id === filters.roomId)
    .flatMap((d) =>
      d.participants.map((p) => {
        const m = metrics(p);
        return {
          participant: p,
          room: d.room,
          status: statusOf(p),
          // Scores are only compared on the 60-mark model.
          score:
            p.scoringVersion === "corporate-60-v1" ? (m.score ?? null) : null,
          minutes: m.minutes,
        };
      }),
    )
    .filter((r) =>
      filters.status === "all"
        ? true
        : filters.status === "Ended at deadline"
          ? r.participant.submissionReason === "deadline"
          : r.status === filters.status,
    );
}

const bins = (
  values: number[],
  edges: [number, number, string][],
): { label: string; count: number }[] =>
  edges.map(([lo, hi, label]) => ({
    label,
    count: values.filter(
      (v) => v >= lo && (v < hi || (hi === edges.at(-1)![1] && v <= hi)),
    ).length,
  }));

export function analytics(data: RoomRecords[], filters: Filters) {
  const rows = rowsFor(data, filters);
  const submitted = rows.filter((r) => r.participant.submittedAt);
  const evaluated = rows.filter((r) => r.status === "Evaluated");
  const scored = evaluated.filter((r) => r.score !== null);
  const pending = rows.filter((r) => r.status === "Awaiting evaluation");
  const atDeadline = submitted.filter(
    (r) => r.participant.submissionReason === "deadline",
  );
  const durations = submitted
    .map((r) => r.minutes)
    .filter((x): x is number => x !== null);

  const kpis = {
    participants: new Set(rows.map((r) => r.participant.identity.id)).size,
    attempts: rows.length,
    submitted: submitted.length,
    atDeadline: atDeadline.length,
    completionRate: rows.length
      ? Math.round((submitted.length / rows.length) * 1000) / 10
      : null,
    pending: pending.length,
    evaluated: evaluated.length,
    averageScore: round1(avg(scored.map((r) => r.score!))),
    averageMinutes: round1(avg(durations)),
  };

  const funnel = [
    { label: "Joined room", count: rows.length },
    {
      label: "Chose 3 challenges",
      count: rows.filter((r) => r.participant.selected.length === 3).length,
    },
    { label: "Submitted", count: submitted.length },
    { label: "Evaluated", count: evaluated.length },
  ];
  const status = (
    ["In progress", "Awaiting evaluation", "Evaluated"] as AttemptStatus[]
  ).map((label) => ({
    label,
    count: rows.filter((r) => r.status === label).length,
  }));

  const challenges = TASK_ORDER.map((task) => {
    const chose = rows.filter((r) => r.participant.selected.includes(task));
    const done = chose.filter((r) => r.participant.submittedAt);
    const mcq = done.map((r) => (r.participant.mcq[task] || 0) * 3);
    const graded = done
      .map((r) => r.participant.grades[task])
      .filter((g): g is NonNullable<typeof g> => !!g);
    const withEvidence = done.filter((r) =>
      r.participant.evidence.some((e) => e.task === task),
    );
    return {
      task,
      label: TASK_SHORT[task],
      selections: chose.length,
      submitted: done.length,
      averageMcq: round1(avg(mcq)),
      averagePractical: round1(
        avg(graded.map((g) => g.completeness + g.accuracy + g.quality)),
      ),
      evidenceRate: done.length
        ? Math.round((withEvidence.length / done.length) * 1000) / 10
        : null,
    };
  });

  // Per-question accuracy, from the host-only aggregate of submitted answers.
  const questionAccuracy = TASK_ORDER.map((task) => ({
    task,
    label: TASK_SHORT[task],
    questions: [0, 1, 2, 3].map((i) => {
      let answered = 0,
        correct = 0;
      for (const d of data)
        if (filters.roomId === "all" || d.room.id === filters.roomId) {
          const q = d.questionStats?.[task]?.[i];
          if (q) {
            answered += q.answered;
            correct += q.correct;
          }
        }
      return {
        answered,
        correct,
        rate: answered ? Math.round((correct / answered) * 1000) / 10 : null,
      };
    }),
  }));

  // Rubric quality of host-graded evidence (automatic no-evidence zeros excluded).
  const manualGrades = submitted.flatMap((r) =>
    r.participant.selected
      .map((t) => r.participant.grades[t])
      .filter((g): g is NonNullable<typeof g> => !!g && !g.automatic),
  );
  const rubric = [
    {
      label: "Completeness",
      max: 3,
      average: round1(avg(manualGrades.map((g) => g.completeness))),
    },
    {
      label: "Accuracy",
      max: 3,
      average: round1(avg(manualGrades.map((g) => g.accuracy))),
    },
    {
      label: "Presentation",
      max: 2,
      average: round1(avg(manualGrades.map((g) => g.quality))),
    },
  ].map((x) => ({
    ...x,
    percent:
      x.average === null ? null : Math.round((x.average / x.max) * 1000) / 10,
  }));

  const scoreBins = bins(
    scored.map((r) => r.score!),
    [
      [0, 10, "0–9"],
      [10, 20, "10–19"],
      [20, 30, "20–29"],
      [30, 40, "30–39"],
      [40, 50, "40–49"],
      [50, 60, "50–60"],
    ],
  );
  const durationBins = bins(durations, [
    [0, 15, "0–15"],
    [15, 30, "15–30"],
    [30, 45, "30–45"],
    [45, 60, "45–60"],
  ]);

  // Submissions per local day, or per hour when they all fall on one day.
  const times = submitted
    .map((r) => new Date(r.participant.submittedAt!))
    .sort((a, b) => +a - +b);
  const dayKey = (d: Date) =>
    d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  const sameDay = new Set(times.map(dayKey)).size <= 1;
  const timeline: { label: string; count: number }[] = [];
  for (const t of times) {
    const label = sameDay
      ? t.toLocaleTimeString("en-IN", { hour: "2-digit", hour12: false }) +
        ":00"
      : dayKey(t);
    const last = timeline.at(-1);
    if (last && last.label === label) last.count++;
    else timeline.push({ label, count: 1 });
  }

  const roomsSummary = data
    .filter((d) => filters.roomId === "all" || d.room.id === filters.roomId)
    .map((d) => {
      const rs = rows.filter((r) => r.room.id === d.room.id);
      const s = rs.filter((r) => r.score !== null);
      return {
        roomId: d.room.id,
        label: `${d.room.company || d.room.name} · ${d.room.batch}`,
        participants: rs.length,
        evaluated: s.length,
        averageScore: round1(avg(s.map((r) => r.score!))),
      };
    })
    .filter((r) => r.participants > 0);

  const scatter = scored
    .filter((r) => r.minutes !== null)
    .map((r) => ({
      name: r.participant.identity.name,
      minutes: Math.round(r.minutes! * 10) / 10,
      score: r.score!,
    }));

  const recent = [...submitted]
    .sort(
      (a, b) =>
        Date.parse(b.participant.submittedAt!) -
        Date.parse(a.participant.submittedAt!),
    )
    .slice(0, 8);
  const queue = [...pending].sort(
    (a, b) =>
      Date.parse(a.participant.submittedAt!) -
      Date.parse(b.participant.submittedAt!),
  );

  return {
    rows,
    kpis,
    funnel,
    status,
    challenges,
    questionAccuracy,
    rubric,
    scoreBins,
    durationBins,
    timeline,
    timelineUnit: sameDay ? "hour" : "day",
    roomsSummary,
    scatter,
    recent,
    queue,
  };
}
