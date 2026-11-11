import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createHash, randomUUID } from "node:crypto";
import { AssessmentService, comparison, metrics } from "./assessment";
import { answerKey, catalogue, layoutOf } from "./challenges";
import {
  AppError,
  type Identity,
  type Participant,
  type Room,
  type Evidence,
} from "./types";
import { getJson } from "./storage";
import { ANSWER_KEY_VERSION, MATERIAL_VERSION } from "./config";
export async function excelReport(
  service: AssessmentService,
  room: Room,
  host: Identity,
  onSaved?: (key: string) => void,
): Promise<Buffer> {
  if (room.mode === "single")
    return singleRoundReport(service, room, host, onSaved);
  const participants = await service.attendees(room.id, host),
    wb = new ExcelJS.Workbook();
  wb.creator = "TechnoEdge Learning Services";
  wb.calcProperties.fullCalcOnLoad = true;
  wb.created = new Date();
  const methodology = wb.addWorksheet("Read me");
  [
    ["TechnoEdge Assessment ROI", "Assessment export"],
    ["Generated UTC", new Date().toISOString()],
    ["Room", room.name],
    ["Phase", room.phase],
    ["Batch", room.batch],
    [
      "Data classification",
      room.dataClassification === "synthetic-test" ||
      participants.some((p) => p.identity.testAccount)
        ? "synthetic-test — local account records; not real employee results"
        : "assessment",
    ],
    [
      "Scoring",
      room.scoringVersion === "corporate-60-v1"
        ? "corporate-60-v1: 3 tasks × (12 MCQ + 8 practical) = 60 marks. Each MCQ awards 3 marks. Final score requires all 3 grades."
        : "legacy-100: MCQ 40% (12 questions), practical 60% (3 tasks × 15 points). Final score requires all 3 grades.",
    ],
    [
      "Practical rubric",
      room.scoringVersion === "corporate-60-v1"
        ? "Completeness /3, accuracy /3, presentation /2 per selected task."
        : "Accuracy, quality, completeness: each 0–5 per selected task.",
    ],
    [
      "Time",
      "Started to submitted, capped at deadline. No active-working-time telemetry. Deadline submissions use the full duration.",
    ],
    [
      "Comparison",
      "Same verified identity, same categories, linked room and duration; complete grading required. Review accuracy/quality alongside speed.",
    ],
    [
      "Evidence",
      "SHA-256 checksums in Evidence sheet. Files in separate host-authorized ZIP.",
    ],
    [
      "ROI",
      "Observed elapsed time is not causal proof of AI impact. Repetition and familiarity may influence results. Financial values are modeled capacity, not realized cash savings.",
    ],
    [
      "Consistency",
      "Rows are a captured per-participant snapshot; a batch is not a cross-record database transaction.",
    ],
  ].forEach((row) => methodology.addRow(row));
  const people = wb.addWorksheet("Participants");
  people.addRow([
    "ID",
    "Name",
    "Email",
    "Status",
    "Selected tasks",
    "Started UTC",
    "Deadline UTC",
    "Submitted UTC",
    "Reason",
    "Minutes",
    "Completed tasks",
    "MCQ /12",
    "Accuracy %",
    "Practical raw marks (24 or 45 maximum)",
    "Quality %",
    "Final score (see scoring version)",
    "Fully graded",
    "Revision",
    "Data classification",
    "Scoring version",
    "Maximum score",
    "MCQ awarded marks",
  ]);
  const answers = wb.addWorksheet("Task answers");
  answers.addRow([
    "Participant ID",
    "Task",
    "Question",
    "Prompt",
    "Selected option (1-based)",
    "Selected answer",
    "Correct option (1-based)",
    "Correct answer",
    "Awarded marks",
    "Maximum marks",
    "Scoring version",
  ]);
  const tasks = wb.addWorksheet("Practical evaluations");
  tasks.addRow([
    "Participant ID",
    "Task",
    "Completed UTC",
    "MCQ /4",
    "Accuracy raw marks (3 or 5 maximum)",
    "Presentation / quality raw marks (2 or 5 maximum)",
    "Completeness raw marks (3 or 5 maximum)",
    "Feedback",
    "Grader ID",
    "Graded UTC",
    "Method notes",
  ]);
  const evidence = wb.addWorksheet("Evidence");
  evidence.addRow([
    "Participant ID",
    "Task",
    "Filename",
    "Bytes",
    "SHA256",
    "Uploaded UTC",
    "Storage path",
  ]);
  const pairs = wb.addWorksheet("Pre Post comparisons");
  pairs.addRow([
    "Participant ID",
    "Pre room",
    "Post room",
    "Comparable",
    "Pre minutes",
    "Post minutes",
    "Minutes saved",
    "Time reduction %",
    "Score delta points",
    "Accuracy delta points",
    "Quality delta points",
  ]);
  const key = answerKey(room.phase, layoutOf(room));
  for (const p of participants) {
    const m = metrics(p);
    people.addRow([
      p.identity.id,
      p.identity.name,
      p.identity.email,
      p.submittedAt ? "Submitted" : p.startedAt ? "In progress" : "Joined",
      p.selected.join(", "),
      p.startedAt,
      p.deadline,
      p.submittedAt,
      p.submissionReason,
      m.minutes,
      m.completed,
      m.mcq,
      m.accuracy,
      m.practical,
      m.quality,
      m.score,
      m.fullyGraded,
      p.revision,
      p.identity.testAccount || room.dataClassification === "synthetic-test"
        ? "synthetic-test"
        : "assessment",
      m.scoringVersion,
      m.maximum,
      m.mcqMarks,
    ]);
    for (const id of p.selected) {
      const g = p.grades[id];
      tasks.addRow([
        p.identity.id,
        catalogue[id].title,
        p.taskCompletedAt[id],
        p.mcq[id],
        g?.accuracy,
        g?.quality,
        g?.completeness,
        g?.feedback,
        g?.graderId,
        g?.at,
        p.notes[id],
      ]);
      key[id].forEach((q, i) => {
        const a = p.answers[id]?.[i];
        answers.addRow([
          p.identity.id,
          id,
          i + 1,
          q.prompt,
          a !== undefined && a >= 0 ? a + 1 : null,
          a !== undefined && a >= 0 ? q.options[a] : null,
          q.correct + 1,
          q.options[q.correct],
          p.submittedAt && a === q.correct
            ? p.scoringVersion === "corporate-60-v1"
              ? 3
              : 1
            : 0,
          p.scoringVersion === "corporate-60-v1" ? 3 : 1,
          p.scoringVersion || "legacy-100",
        ]);
      });
    }
    for (const e of p.evidence)
      evidence.addRow([
        p.identity.id,
        e.task,
        e.name,
        e.size,
        e.sha256,
        e.uploadedAt,
        e.path,
      ]);
    if (room.phase === "post" && room.preRoomId) {
      const pre = await service.participant(room.preRoomId, p.identity.id);
      if (pre) {
        const c = comparison(pre, p);
        pairs.addRow([
          p.identity.id,
          room.preRoomId,
          room.id,
          c.comparable,
          metrics(pre).minutes,
          m.minutes,
          c.minutesSaved,
          c.timeReduction,
          c.scoreDelta,
          c.accuracyDelta,
          c.qualityDelta,
        ]);
      }
    }
  }
  const roi = wb.addWorksheet("Modeled ROI");
  roi.addRow(["Assumption / result", "Value", "Interpretation"]);
  roi.addRow([
    "Observed paired minutes saved per cycle",
    null,
    "Enter an eligible paired result from Pre Post comparisons; negative values are allowed.",
  ]);
  roi.addRow(["Cycles per year", 12, "Editable assumption"]);
  roi.addRow(["Loaded hourly cost INR", 1000, "Editable assumption"]);
  roi.addRow(["Adoption fraction", 0.7, "Editable assumption 0–1"]);
  roi.addRow(["Annual investment INR", 0, "Editable assumption"]);
  roi.addRow([
    "Annual capacity value INR",
    { formula: "IF(ISNUMBER(B2),B2/60*B3*B4*B5,0)" },
    "Modeled, not realized savings",
  ]);
  roi.addRow([
    "Modeled net value INR",
    { formula: "B7-B6" },
    "Capacity value less investment",
  ]);
  roi.addRow([
    "Modeled ROI %",
    { formula: "IF(B6>0,(B7-B6)/B6*100,0)" },
    "Requires a positive investment assumption",
  ]);
  for (const sheet of wb.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF5046B8" },
    };
    sheet.columns.forEach((c) => {
      c.width = 24;
    });
    if (sheet.rowCount > 1)
      sheet.autoFilter = {
        from: "A1",
        to: { row: sheet.rowCount, column: sheet.columnCount },
      };
  }
  const data = Buffer.from(await wb.xlsx.writeBuffer());
  const file = `rooms/${room.id}/reports/${Date.now()}-${randomUUID()}.xlsx`;
  await service.store.write(file, data, null);
  onSaved?.(file);
  return data;
}
const STATUS = (p: Participant, fullyGraded: boolean) =>
  !p.submittedAt
    ? p.startedAt
      ? "IN_PROGRESS"
      : "READY"
    : p.submissionReason === "deadline"
      ? "EXPIRED"
      : fullyGraded
        ? "FINALIZED"
        : "AWAITING_EVALUATION";
// Single-round export: six sheets built from the canonical participant records.
async function singleRoundReport(
  service: AssessmentService,
  room: Room,
  host: Identity,
  onSaved?: (key: string) => void,
) {
  const participants = await service.attendees(room.id, host),
    wb = new ExcelJS.Workbook(),
    generated = new Date().toISOString();
  wb.creator = "TechnoEdge Learning Services";
  wb.created = new Date();
  const people = wb.addWorksheet("Participants");
  people.addRow([
    "Participant ID",
    "Participant name",
    "Verified email",
    "Company",
    "Cohort",
    "Room code",
    "Email verified (UTC)",
    "Attempt started (UTC)",
    "Deadline (UTC)",
    "Submitted (UTC)",
    "Expired (UTC)",
    "Status",
    "Selected challenges",
    "Challenges completed",
  ]);
  const answers = wb.addWorksheet("Question Answers");
  answers.addRow([
    "Participant ID",
    "Participant name",
    "Challenge ID",
    "Question ID",
    "Question",
    "Chosen option",
    "Chosen answer",
    "Correct option",
    "Correct answer",
    "Correct",
    "Marks",
    "Maximum marks",
    "Saved (UTC)",
    "Answer key version",
  ]);
  const results = wb.addWorksheet("Challenge Results");
  results.addRow([
    "Participant ID",
    "Participant name",
    "Challenge ID",
    "Challenge",
    "MCQ subtotal (0-12)",
    "Practical subtotal (0-8)",
    "Total (0-20)",
    "Completeness (0-3)",
    "Accuracy (0-3)",
    "Presentation (0-2)",
    "Evidence status",
    "Graded by",
    "Graded (UTC)",
    "Grading notes",
  ]);
  const overall = wb.addWorksheet("Overall Results");
  overall.addRow([
    "Participant ID",
    "Participant name",
    "Selected challenges",
    "Challenges completed",
    "MCQ marks (0-36)",
    "Practical marks (0-24)",
    "Raw marks out of 60",
    "Percentage",
    "Grade status",
    "Attempt status",
    "Elapsed minutes",
    "Finalized (UTC)",
    "Scoring version",
  ]);
  const log = wb.addWorksheet("Evidence Log");
  log.addRow([
    "Participant ID",
    "Participant name",
    "Event",
    "Challenge ID",
    "File name",
    "File type",
    "Size (bytes)",
    "SHA-256",
    "Protected storage reference",
    "Confirmed (UTC)",
  ]);
  const key = answerKey(room.phase, layoutOf(room));
  for (const p of participants) {
    const m = metrics(p),
      status = STATUS(p, m.fullyGraded),
      registered = await getJson<{ verifiedAt?: string }>(
        service.store,
        `identities/${p.identity.id}.json`,
      );
    people.addRow([
      p.identity.id,
      p.identity.name,
      p.identity.email,
      room.company,
      room.batch,
      room.id,
      registered?.verifiedAt ?? null,
      p.startedAt,
      p.deadline,
      p.submissionReason === "manual" ? p.submittedAt : null,
      p.submissionReason === "deadline" ? p.submittedAt : null,
      status,
      p.selected.join(", "),
      m.completed,
    ]);
    let gradedAt = "";
    for (const id of p.selected) {
      const g = p.grades[id],
        files = p.evidence.filter((e) => e.task === id).length,
        mcqMarks = p.submittedAt ? (p.mcq[id] || 0) * 3 : null,
        practical = g ? g.accuracy + g.quality + g.completeness : null;
      if (g && g.at > gradedAt) gradedAt = g.at;
      results.addRow([
        p.identity.id,
        p.identity.name,
        id,
        catalogue[id].title,
        mcqMarks,
        practical ?? (p.submittedAt ? "Pending" : null),
        mcqMarks !== null && practical !== null
          ? mcqMarks + practical
          : p.submittedAt
            ? "Pending"
            : null,
        g?.completeness,
        g?.accuracy,
        g?.quality,
        files ? `${files} file(s) received` : "No evidence submitted",
        g ? (g.automatic ? "System (no-evidence policy)" : g.graderId) : null,
        g?.at,
        g?.feedback,
      ]);
      key[id].forEach((q, i) => {
        const a = p.answers[id]?.[i];
        if (a === undefined || a < 0) return;
        answers.addRow([
          p.identity.id,
          p.identity.name,
          id,
          `${id}-q${i + 1}`,
          q.prompt,
          a + 1,
          q.options[a],
          q.correct + 1,
          q.options[q.correct],
          a === q.correct ? "Yes" : "No",
          a === q.correct ? 3 : 0,
          3,
          p.answerSavedAt?.[id]?.[i] ?? p.lastSeenAt,
          `${ANSWER_KEY_VERSION} · options ${layoutOf(room)}`,
        ]);
      });
    }
    overall.addRow([
      p.identity.id,
      p.identity.name,
      p.selected.join(", "),
      m.completed,
      p.submittedAt ? m.mcqMarks : null,
      m.fullyGraded ? m.practical : null,
      m.score ?? (p.submittedAt ? "Pending" : null),
      m.score !== null ? Math.round((m.score / 60) * 1000) / 10 : null,
      !p.submittedAt
        ? "Not submitted"
        : m.fullyGraded
          ? "Final"
          : p.selected.length !== 3
            ? "No challenges selected before expiry"
            : "Pending practical evaluation",
      status,
      m.minutes !== null ? Math.round(m.minutes * 10) / 10 : null,
      m.fullyGraded ? gradedAt || p.submittedAt : null,
      m.scoringVersion,
    ]);
    if (p.startedAt)
      log.addRow([
        p.identity.id,
        p.identity.name,
        "Attempt started",
        ...Array(6).fill(null),
        p.startedAt,
      ]);
    for (const e of p.evidence)
      log.addRow([
        p.identity.id,
        p.identity.name,
        "Evidence upload confirmed",
        e.task,
        e.name,
        e.name.split(".").pop()?.toLowerCase(),
        e.size,
        e.sha256,
        e.path,
        e.uploadedAt,
      ]);
    if (p.submittedAt)
      log.addRow([
        p.identity.id,
        p.identity.name,
        p.submissionReason === "deadline"
          ? "Attempt expired at deadline; saved work locked"
          : "Final submission by participant",
        ...Array(6).fill(null),
        p.submittedAt,
      ]);
  }
  const dictionary = wb.addWorksheet("Data Dictionary");
  [
    ["Item", "Meaning"],
    ["Export generated (UTC)", generated],
    ["Company / cohort", `${room.company} / ${room.batch}`],
    ["Room code", room.id],
    ["Scoring version", room.scoringVersion || "legacy-100"],
    ["Material version", MATERIAL_VERSION],
    ["Answer key version", ANSWER_KEY_VERSION],
    [
      "Option layout",
      layoutOf(room) === "balanced-v2"
        ? "balanced-v2: options in ascending order; the correct value's position varies by question."
        : "sequential-v1: original option order (room created before balanced-v2).",
    ],
    [
      "Scoring",
      "Three challenges x (4 MCQs x 3 marks = 12, plus practical evidence out of 8) = 60 marks.",
    ],
    [
      "Practical rubric",
      "Completeness 0-3, accuracy 0-3, presentation 0-2, entered by a TechnoEdge host.",
    ],
    [
      "No-evidence policy",
      "A selected challenge with no uploaded evidence receives 0 practical marks automatically at submission or expiry (graded by System).",
    ],
    [
      "Expiry policy",
      "At 60 minutes the attempt locks. Answers and evidence saved before the deadline are marked; unanswered questions score 0.",
    ],
    ["READY", "Joined; attempt not yet started."],
    ["IN_PROGRESS", "Timer running; work not yet submitted."],
    ["AWAITING_EVALUATION", "Submitted; practical marks not yet complete."],
    ["FINALIZED", "Submitted and all three practical evaluations recorded."],
    ["EXPIRED", "Timer ended before submission; saved work was locked."],
    [
      "Pending",
      "Shown in place of a total or percentage until every practical evaluation is recorded.",
    ],
    [
      "Times",
      "All timestamps are UTC (ISO 8601). Elapsed minutes run from confirmed join to submission or deadline.",
    ],
    [
      "Scope",
      "One assessment round. This export contains no Pre/Post comparison and no modeled ROI.",
    ],
    [
      "Correct option",
      "Answer keys appear in this host export only; they are never sent to attendees.",
    ],
  ].forEach((row) => dictionary.addRow(row));
  for (const sheet of wb.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2A5C" },
    };
    sheet.columns.forEach((c) => {
      c.width = 24;
    });
    if (sheet.rowCount > 1 && sheet !== dictionary)
      sheet.autoFilter = {
        from: "A1",
        to: { row: sheet.rowCount, column: sheet.columnCount },
      };
  }
  dictionary.getColumn(2).width = 110;
  const data = Buffer.from(await wb.xlsx.writeBuffer());
  const file = `rooms/${room.id}/reports/${Date.now()}-${randomUUID()}.xlsx`;
  await service.store.write(file, data, null);
  onSaved?.(file);
  return data;
}
export type EvidenceSnapshot = {
  participant: { id: string; name: string; testAccount?: true };
  e: Evidence;
};
export async function evidenceZip(
  service: AssessmentService,
  room: Room,
  host: Identity,
  onSaved?: (key: string) => void,
  snapshot?: EvidenceSnapshot[],
) {
  service.assertHost(room, host);
  const people = snapshot ? [] : await service.attendees(room.id, host);
  const files = snapshot
    ? snapshot.map((x) => ({ p: { identity: x.participant }, e: x.e }))
    : people.flatMap((p) => p.evidence.map((e) => ({ p, e })));
  if (files.reduce((n, x) => n + x.e.size, 0) > 150 * 1024 * 1024)
    throw new AppError(
      413,
      "Batch archive exceeds 150 MB. Download individual evidence files from evaluations.",
    );
  const zip = new JSZip();
  const manifest = [];
  for (const { p, e } of files) {
    const blob = await service.store.read(e.path);
    if (!blob)
      throw new AppError(
        503,
        `Evidence missing for ${p.identity.name}. Archive cancelled.`,
      );
    if (
      blob.data.length !== e.size ||
      createHash("sha256").update(blob.data).digest("hex") !== e.sha256
    )
      throw new AppError(503, "Evidence checksum mismatch. Archive cancelled.");
    zip.file(
      `${p.identity.id}/${e.task}/${e.id.slice(0, 12)}-${e.name}`,
      blob.data,
    );
    manifest.push({ participant: p.identity.id, ...e });
  }
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        roomId: room.id,
        dataClassification:
          room.dataClassification === "synthetic-test" ||
          files.some((x) => x.p.identity.testAccount)
            ? "synthetic-test"
            : "assessment",
        generatedAt: new Date().toISOString(),
        files: manifest,
      },
      null,
      2,
    ),
  );
  const data = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const archiveKey = `rooms/${room.id}/reports/${Date.now()}-${randomUUID()}-evidence.zip`;
  await service.store.write(archiveKey, data, null);
  onSaved?.(archiveKey);
  return data;
}
