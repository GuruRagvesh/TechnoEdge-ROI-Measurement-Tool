export const TASK_IDS = [
  "inbox",
  "tables",
  "clean",
  "dashboard",
  "mbr",
] as const;
export type TaskId = (typeof TASK_IDS)[number];
export type Phase = "pre" | "post";
export type Identity = {
  testAccount?: true;
  testGeneration?: string;
  preview?: true;
  developmentOnly?: true;
  previewGeneration?: string;
  id: string;
  name: string;
  email: string;
  role: "host" | "attendee";
};
export type ScoringVersion = "legacy-100" | "corporate-60-v1";
export type Program = {
  id: string;
  company: string;
  cohort: string;
  ownerId: string;
  preRoomId: string;
  postRoomId: string;
  createdAt: string;
  ready: boolean;
  // "single" = one assessment round; postRoomId is empty. Absent = paired Base Camp/Summit.
  mode?: "single";
};
export type Room = {
  mode?: "single";
  programId?: string;
  company?: string;
  scoringVersion?: ScoringVersion;
  dataClassification?: "synthetic-test";
  id: string;
  name: string;
  phase: Phase;
  durationMinutes: number;
  ownerId: string;
  batch: string;
  preRoomId?: string;
  createdAt: string;
  closed: boolean;
};
export type Evidence = {
  id: string;
  task: TaskId;
  name: string;
  size: number;
  sha256: string;
  path: string;
  uploadedAt: string;
  contentType: string;
};
export type Grade = {
  quality: number;
  accuracy: number;
  completeness: number;
  feedback: string;
  graderId: string;
  at: string;
  // Set when the zero was recorded by the no-evidence policy, not by a host.
  automatic?: true;
};
export type Participant = {
  uploadReservations?: string[];
  scoringVersion?: ScoringVersion;
  identity: Identity;
  roomId: string;
  selected: TaskId[];
  answers: Partial<Record<TaskId, number[]>>;
  // Server time each answer last changed; index-aligned with answers.
  answerSavedAt?: Partial<Record<TaskId, (string | null)[]>>;
  notes: Partial<Record<TaskId, string>>;
  evidence: Evidence[];
  startedAt: string | null;
  deadline: string | null;
  submittedAt: string | null;
  submissionReason?: "manual" | "deadline";
  revision: number;
  mcq: Partial<Record<TaskId, number>>;
  grades: Partial<Record<TaskId, Grade>>;
  gradingHistory?: (Grade & { task: TaskId })[];
  taskCompletedAt: Partial<Record<TaskId, string>>;
  lastSeenAt: string;
};
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export const iso = () => new Date().toISOString();
