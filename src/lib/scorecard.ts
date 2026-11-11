// One definition of every dashboard figure, shared by the Host and Attendee
// dashboards so both always agree with each other and with the Excel export.
// Pure functions over persisted participant records; a figure that the
// records cannot support is null and is shown as "Not available".
import { comparison, metrics } from "./metrics";
import type { Participant, Room, TaskId } from "./types";

export const TASK_ORDER: TaskId[] = [
  "inbox",
  "tables",
  "clean",
  "dashboard",
  "mbr",
];
export const TASK_LABEL: Record<TaskId, string> = {
  inbox: "Inbox Inferno",
  tables: "Hundred-Table Puzzle",
  clean: "Dirty Data Disaster",
  dashboard: "Dashboard Build",
  mbr: "MBR Deadline",
};

export type AssessmentStatus =
  | "Not started"
  | "In progress"
  | "Submitted"
  | "Evaluated";
export type EvaluationStatus = "Not submitted" | "Pending" | "Finalized";

export type ChallengeResult = {
  task: TaskId;
  label: string;
  mcqCorrect: number | null; // of 4, known after submission
  mcqMarks: number | null; // of 12
  practical: number | null; // of 8, once evaluated
  automaticZero: boolean; // no evidence by the deadline
  total: number | null; // of 20, once evaluated
  evidence: string | null; // file name the server verified
  completed: boolean;
};

export type Card = {
  roomId: string;
  roomLabel: string;
  participantId: string;
  name: string;
  status: AssessmentStatus;
  endedAtDeadline: boolean;
  evaluation: EvaluationStatus;
  maximum: number;
  score: number | null;
  attempted: number; // challenges selected, of 5
  minutes: number | null;
  mcqAnswered: number;
  mcqCorrect: number | null;
  accuracy: number | null; // correct ÷ answered, percent
  evidenceReceived: number;
  evidenceExpected: number;
  completion: number; // percent of selected challenges marked complete
  pre: number | null;
  post: number | null;
  improvement: number | null;
  submittedAt: string | null;
  challenges: ChallengeResult[];
};

const round1 = (x: number) => Math.round(x * 10) / 10;

export function statusOf(p: Participant): AssessmentStatus {
  if (!p.startedAt) return "Not started";
  if (!p.submittedAt) return "In progress";
  return metrics(p).fullyGraded ? "Evaluated" : "Submitted";
}

export const roomLabel = (room: Room) =>
  [room.company || room.name, room.batch].filter(Boolean).join(" · ");

// A Pre/Post pair only counts when the same person completed both linked
// rooms and both were fully evaluated (the existing comparison rules).
export function pairOf(
  pre: Participant | null | undefined,
  post: Participant | null | undefined,
) {
  if (!pre || !post) return null;
  const c = comparison(pre, post);
  if (!c.comparable) return null;
  return {
    pre: metrics(pre).score!,
    post: metrics(post).score!,
    improvement: c.scoreDelta!,
  };
}

export function card(
  room: Room,
  p: Participant,
  pair: ReturnType<typeof pairOf> = null,
): Card {
  const m = metrics(p);
  const submitted = !!p.submittedAt;
  const answered = p.selected.reduce(
    (n, t) => n + (p.answers[t] || []).filter((x) => x >= 0).length,
    0,
  );
  const correct = submitted
    ? p.selected.reduce((n, t) => n + (p.mcq[t] || 0), 0)
    : null;
  const per = m.maximum === 60 ? 3 : 1;
  const challenges = p.selected.map((task) => {
    const g = p.grades[task];
    const practical = g ? g.completeness + g.accuracy + g.quality : null;
    const mcqCorrect = submitted ? p.mcq[task] || 0 : null;
    const file = p.evidence.filter((e) => e.task === task).at(-1);
    return {
      task,
      label: TASK_LABEL[task],
      mcqCorrect,
      mcqMarks: mcqCorrect === null ? null : mcqCorrect * per,
      practical,
      automaticZero: !!g?.automatic,
      total:
        mcqCorrect !== null && practical !== null
          ? mcqCorrect * per + practical
          : null,
      evidence: file ? file.name : null,
      completed: !!p.taskCompletedAt[task],
    };
  });
  return {
    roomId: room.id,
    roomLabel: roomLabel(room),
    participantId: p.identity.id,
    name: p.identity.name,
    status: statusOf(p),
    endedAtDeadline: p.submissionReason === "deadline",
    evaluation: !submitted
      ? "Not submitted"
      : m.fullyGraded
        ? "Finalized"
        : "Pending",
    maximum: m.maximum,
    score: m.score,
    attempted: p.selected.length,
    minutes: m.minutes === null ? null : round1(m.minutes),
    mcqAnswered: answered,
    mcqCorrect: correct,
    accuracy:
      correct !== null && answered > 0
        ? round1((correct / answered) * 100)
        : null,
    evidenceReceived: challenges.filter((c) => c.evidence).length,
    evidenceExpected: p.selected.length,
    completion: p.selected.length
      ? round1(
          (Object.keys(p.taskCompletedAt).filter((t) =>
            p.selected.includes(t as TaskId),
          ).length /
            3) *
            100,
        )
      : 0,
    pre: pair?.pre ?? null,
    post: pair?.post ?? null,
    improvement: pair?.improvement ?? null,
    submittedAt: p.submittedAt || null,
    challenges,
  };
}

export type RoomRecords = { room: Room; participants: Participant[] };

// Cards for every attempt the host can see, with Pre/Post pairs matched
// through linked rooms (post.preRoomId). Single-assessment rooms have no
// link, so their Pre/Post fields stay null.
export function cardsFor(data: RoomRecords[]): Card[] {
  const byRoom = new Map(data.map((d) => [d.room.id, d]));
  const postOf = new Map(
    data
      .filter((d) => d.room.preRoomId)
      .map((d) => [d.room.preRoomId!, d] as const),
  );
  return data.flatMap(({ room, participants }) =>
    participants.map((p) => {
      const preRoom = room.preRoomId ? byRoom.get(room.preRoomId) : undefined;
      const postRoom = postOf.get(room.id);
      const pair = preRoom
        ? pairOf(
            preRoom.participants.find((x) => x.identity.id === p.identity.id),
            p,
          )
        : postRoom
          ? pairOf(
              p,
              postRoom.participants.find((x) => x.identity.id === p.identity.id),
            )
          : null;
      return card(room, p, pair);
    }),
  );
}

const avg = (xs: number[]) =>
  xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

// Aggregate view for the Host. Each average says how many records it uses.
export function summary(cards: Card[]) {
  const started = cards.filter((c) => c.status !== "Not started");
  const submitted = cards.filter((c) => c.submittedAt);
  const finalized = cards.filter((c) => c.score !== null);
  const pairs = cards.filter((c) => c.improvement !== null && c.post !== null);
  // A pair appears on both its Pre and Post card; count each person once.
  const uniquePairs = [
    ...new Map(pairs.map((c) => [c.participantId + c.post, c])).values(),
  ];
  const answered = submitted.reduce((n, c) => n + c.mcqAnswered, 0);
  const correct = submitted.reduce((n, c) => n + (c.mcqCorrect || 0), 0);
  const status = (["Not started", "In progress", "Submitted", "Evaluated"] as const).map(
    (label) => ({ label, count: cards.filter((c) => c.status === label).length }),
  );
  const challenges = TASK_ORDER.map((task) => {
    const rows = submitted
      .map((c) => c.challenges.find((x) => x.task === task))
      .filter((x): x is ChallengeResult => !!x);
    const graded = rows.filter((r) => r.total !== null);
    return {
      task,
      label: TASK_LABEL[task],
      attempts: rows.length,
      mcqMarks: avg(rows.map((r) => r.mcqMarks!)),
      practical: avg(graded.map((r) => r.practical!)),
      total: avg(graded.map((r) => r.total!)),
      evaluated: graded.length,
      evidence: rows.filter((r) => r.evidence).length,
    };
  });
  return {
    attempts: cards.length,
    started: started.length,
    submitted: submitted.length,
    finalized: finalized.length,
    pending: cards.filter((c) => c.evaluation === "Pending").length,
    score: avg(finalized.map((c) => c.score!)),
    attempted: avg(started.map((c) => c.attempted)),
    minutes: avg(submitted.map((c) => c.minutes!).filter((x) => x !== null)),
    mcqAnswered: answered,
    mcqCorrect: correct,
    accuracy: answered ? round1((correct / answered) * 100) : null,
    evidenceReceived: started.reduce((n, c) => n + c.evidenceReceived, 0),
    evidenceExpected: started.reduce((n, c) => n + c.evidenceExpected, 0),
    completion: avg(started.map((c) => c.completion)),
    pairs: uniquePairs.length,
    pre: avg(uniquePairs.map((c) => c.pre!)),
    post: avg(uniquePairs.map((c) => c.post!)),
    improvement: avg(uniquePairs.map((c) => c.improvement!)),
    status,
    challenges,
  };
}
