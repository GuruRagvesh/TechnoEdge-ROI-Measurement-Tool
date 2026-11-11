"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileUp,
  LockKeyhole,
  Save,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  DownloadLink,
  ErrorBox,
  format,
  Loading,
  Shell,
  Stat,
  useIdentity,
} from "@/components/ui";
import type { Participant, Room, TaskId } from "@/lib/types";
import { directEvidenceUpload } from "@/components/direct-evidence-upload";
import { metrics } from "@/lib/metrics";
import type { publicTasks } from "@/lib/challenges";
type Task = ReturnType<typeof publicTasks>[number];
type Detail = {
  room: Room;
  participant: Participant;
  tasks: Task[];
  preSelected: TaskId[] | null;
  serverTime: string;
  evidenceLimitMB?: number;
  uploadTransport?: "graph-direct" | "local-multipart";
};
type Draft = {
  answers: Participant["answers"];
  notes: Participant["notes"];
  completed: TaskId[];
};
export default function Assessment({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const path = usePathname();
  const { id } = use(params),
    { identity, error: authError } = useIdentity("attendee");
  const [detail, setDetail] = useState<Detail | null>(null),
    [selected, setSelected] = useState<TaskId[]>([]),
    [active, setActive] = useState<TaskId>("inbox"),
    [draft, setDraft] = useState<Draft>({
      answers: {},
      notes: {},
      completed: [],
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("All changes saved"),
    [tick, setTick] = useState(Date.now()),
    [dirty, setDirty] = useState(false),
    [confirmSubmit, setConfirmSubmit] = useState(false),
    [lastSaved, setLastSaved] = useState(""),
    [uploadStatus, setUploadStatus] = useState(""),
    [retry, setRetry] = useState(0);
  const participantRef = useRef<Participant | null>(null),
    draftRef = useRef(draft),
    version = useRef(0),
    savedVersion = useRef(0),
    saving = useRef<Promise<void> | null>(null),
    offset = useRef(0),
    blocked = useRef(false),
    mounted = useRef(true);
  const base = `rooms/${id}`;
  useEffect(() => {
    setConfirmSubmit(path.endsWith("/review"));
  }, [path]);
  useEffect(() => {
    if (detail?.participant.submittedAt) setConfirmSubmit(false);
  }, [detail?.participant.submittedAt]);
  const install = useCallback((d: Detail) => {
    setDetail(d);
    participantRef.current = d.participant;
    offset.current = Date.parse(d.serverTime) - Date.now();
    setSelected(d.preSelected || d.participant.selected);
    if (d.participant.selected[0]) setActive(d.participant.selected[0]);
    const initial = {
      answers: d.participant.answers,
      notes: d.participant.notes,
      completed: Object.keys(d.participant.taskCompletedAt) as TaskId[],
    };
    draftRef.current = initial;
    setDraft(initial);
    savedVersion.current = version.current;
    setDirty(false);
    blocked.current = false;
    setStatus("All changes saved");
    setLastSaved(d.participant.lastSeenAt);
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (identity)
      api<Detail>(base)
        .then(install)
        .catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
    };
  }, [identity, base, install]);
  const flush = useCallback(async () => {
    if (saving.current) {
      await saving.current;
      if (savedVersion.current === version.current) return;
    }
    if (blocked.current)
      throw new Error(
        "Resolve the save conflict by reloading saved work. Copy any unsaved notes first.",
      );
    if (savedVersion.current === version.current) return;
    const work = async () => {
      while (savedVersion.current < version.current) {
        const snapshot = structuredClone(draftRef.current),
          v = version.current,
          p = participantRef.current;
        if (!p || p.submittedAt) throw new Error("Assessment locked.");
        setStatus("Saving…");
        try {
          const result = await api<{ participant: Participant }>(
            base + "/save",
            { ...snapshot, revision: p.revision },
          );
          participantRef.current = result.participant;
          savedVersion.current = v;
          if (mounted.current) {
            setDetail((d) =>
              d ? { ...d, participant: result.participant } : d,
            );
            setLastSaved(result.participant.lastSeenAt);
            setDirty(v !== version.current);
            setStatus(
              v === version.current ? "All changes saved" : "Unsaved changes",
            );
            setError("");
          }
        } catch (e) {
          const message = (e as Error).message;
          if (message.includes("Another tab")) blocked.current = true;
          const final = blocked.current || /locked|closed/i.test(message);
          setStatus(
            final
              ? "Save failed · retry needed"
              : "Not yet saved · retrying automatically",
          );
          setError(message);
          if (!final && mounted.current) setRetry((n) => n + 1);
          throw e;
        }
      }
    };
    saving.current = work();
    try {
      await saving.current;
    } finally {
      saving.current = null;
    }
  }, [base]);
  function edit(next: Draft) {
    draftRef.current = next;
    version.current++;
    setDraft(next);
    setDirty(true);
    setStatus("Unsaved changes");
  }
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [draft, dirty, flush]);
  useEffect(() => {
    // A failed save is retried without waiting for the next edit.
    if (!retry) return;
    const timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 8000);
    return () => clearTimeout(timer);
  }, [retry, flush]);
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (version.current !== savedVersion.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);
  useEffect(() => {
    if (!detail?.participant.startedAt || detail.participant.submittedAt)
      return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [detail?.participant.startedAt, detail?.participant.submittedAt]);
  useEffect(() => {
    if (!detail?.participant.startedAt || detail.participant.submittedAt)
      return;
    const timer = setInterval(() => {
      api<Detail>(base)
        .then((d) => {
          offset.current = Date.parse(d.serverTime) - Date.now();
          if (d.participant.submittedAt) {
            participantRef.current = d.participant;
            setDetail(d);
            setDirty(false);
            savedVersion.current = version.current;
            setStatus("Assessment locked");
            setError("");
          }
        })
        .catch((e) => setError(e.message));
    }, 15000);
    return () => clearInterval(timer);
  }, [base, detail?.participant.startedAt, detail?.participant.submittedAt]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      await api(base + "/start", { selected });
      install(await api<Detail>(base));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > (detail?.evidenceLimitMB || 25) * 1024 * 1024) {
      setError(`Choose a file up to ${detail?.evidenceLimitMB || 25} MiB.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await flush();
      let participant: Participant;
      if (detail?.uploadTransport === "graph-direct")
        participant = await directEvidenceUpload(
          "/api/" + base,
          file,
          active,
          setUploadStatus,
        );
      else {
        const form = new FormData();
        form.set("task", active);
        form.set("file", file);
        setUploadStatus("Uploading and verifying evidence…");
        const response = await fetch("/api/" + base + "/upload", {
          method: "POST",
          body: form,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        participant = result.participant;
        setUploadStatus("Evidence saved securely");
      }
      const result = { participant };
      participantRef.current = result.participant;
      setDetail((d) => (d ? { ...d, participant: result.participant } : d));
      setLastSaved(result.participant.lastSeenAt);
    } catch (e) {
      setError((e as Error).message);
      setUploadStatus(
        "Upload not attached. Select the same file to resume or retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await flush();
      const result = await api<{ participant: Participant }>(
        base + "/submit",
        {},
      );
      participantRef.current = result.participant;
      setDetail((d) => (d ? { ...d, participant: result.participant } : d));
      setConfirmSubmit(false);
      history.replaceState(null, "", "/attendee/attempt/" + id + "/submitted");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!identity || !detail)
    return authError || error ? (
      <div className="loading">
        <ErrorBox message={authError || error} />
        <Link href="/attendee">Return to assessments</Link>
      </div>
    ) : (
      <Loading />
    );
  const p = detail.participant,
    room = detail.room,
    tasks = detail.tasks,
    task = tasks.find((t) => t.id === active)!;
  const remaining = p.deadline
    ? Math.max(0, Date.parse(p.deadline) - tick - offset.current)
    : room.durationMinutes * 60000;
  const minutes = Math.floor(remaining / 60000),
    seconds = Math.floor((remaining % 60000) / 1000);
  const locked = remaining === 0 || !!p.submittedAt;
  const mcq = Object.values(p.mcq).reduce((a, b) => a + (b || 0), 0),
    grades = Object.values(p.grades),
    fullyGraded = grades.length === 3,
    practical = grades.reduce(
      (n, g) => n + g.accuracy + g.quality + g.completeness,
      0,
    );
  return (
    <Shell identity={identity}>
      <Link href="/attendee" className="back-link">
        <ArrowLeft size={16} /> My assessments
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {room.mode === "single"
              ? (room.company || "TECHNOEDGE").toUpperCase() + " · ONE ATTEMPT"
              : room.phase === "pre"
                ? "PRE-AI · ESTABLISH YOUR BASELINE"
                : "POST-AI · MEASURE YOUR PROGRESS"}
          </div>
          <h1>{room.name}</h1>
          <p>
            {room.batch} <span>·</span> {room.durationMinutes} minutes{" "}
            <span>·</span>{" "}
            {room.phase === "post"
              ? "Your three matched challenges"
              : "Complete any 3 challenges"}
          </p>
        </div>
        {room.mode !== "single" && (
          <span className="pill lavender">{room.phase.toUpperCase()}-AI</span>
        )}
      </div>
      <ErrorBox message={error} />
      {!p.submittedAt && (
        <div
          className={"attempt-clock " + (remaining < 300000 ? "urgent" : "")}
          role="status"
        >
          <strong>
            {String(minutes).padStart(2, "0")}:
            {String(seconds).padStart(2, "0")} remaining
          </strong>
          <span>
            {locked
              ? "Time ended. Your attempt is locked."
              : "The timer continues while choosing tasks and while disconnected."}
          </span>
        </div>
      )}
      {!confirmSubmit &&
        (p.submittedAt ? (
          <>
            <section className="result-banner">
              <CheckCircle2 size={40} />
              <div>
                <span className="eyebrow">ASSESSMENT SUBMITTED</span>
                <h2>Submission received</h2>
                <p>
                  {p.submissionReason === "deadline"
                    ? "Your timer ended. All work saved before the deadline was submitted."
                    : "Your answers and evidence are locked and ready for evaluation."}
                </p>
              </div>
            </section>
            <div className="stats-grid">
              <Stat
                label="MCQ score"
                value={`${metrics(p).mcqMarks} / ${p.scoringVersion === "corporate-60-v1" ? 36 : 12}`}
                detail="Automatically marked"
              />
              <Stat
                label="MCQ accuracy"
                value={format((mcq / 12) * 100, "%")}
              />
              <Stat
                label="Elapsed time"
                value={format(
                  (Date.parse(p.submittedAt) - Date.parse(p.startedAt!)) /
                    60000,
                  " min",
                )}
              />
              <Stat
                label="Final score"
                value={
                  fullyGraded
                    ? `${metrics(p).score} / ${metrics(p).maximum}`
                    : "Pending"
                }
                detail={
                  p.scoringVersion === "corporate-60-v1"
                    ? "36 MCQ + 24 practical marks"
                    : "Historical model: 40% MCQ + 60% practical"
                }
              />
            </div>
            <section className="panel">
              <h2>Your challenge results</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Challenge</th>
                      <th>Completion</th>
                      <th>
                        MCQ /{p.scoringVersion === "corporate-60-v1" ? 12 : 4}
                      </th>
                      <th>
                        Practical /
                        {p.scoringVersion === "corporate-60-v1" ? 8 : 15}
                      </th>
                      <th>Evaluator feedback</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.selected.map((t) => (
                      <tr key={t}>
                        <td>
                          <strong>
                            {tasks.find((x) => x.id === t)?.title}
                          </strong>
                        </td>
                        <td>
                          {p.taskCompletedAt[t] ? "Completed" : "Incomplete"}
                        </td>
                        <td>
                          {(p.mcq[t] ?? 0) *
                            (p.scoringVersion === "corporate-60-v1" ? 3 : 1)}
                        </td>
                        <td>
                          {p.grades[t]
                            ? p.grades[t]!.accuracy +
                              p.grades[t]!.quality +
                              p.grades[t]!.completeness
                            : "Pending"}
                        </td>
                        <td>
                          {p.grades[t]?.feedback ||
                            "Awaiting practical evaluation"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="help">
                {p.scoringVersion === "corporate-60-v1"
                  ? "Practical rubric: completeness /3, accuracy /3, presentation /2."
                  : "Historical rubric: accuracy, quality and completeness each /5."}{" "}
                A final score is released after all three evaluations.
              </p>
            </section>
            <Link className="button primary" href="/attendee">
              Back to your dashboard <ArrowRight size={16} />
            </Link>
          </>
        ) : p.selected.length !== 3 ? (
          <>
            <section className="intro-panel">
              <div className="intro-icon">
                <ShieldCheck size={28} />
              </div>
              <div>
                <h2>
                  {room.phase === "post"
                    ? "The same skills. A different dataset."
                    : "Choose your three challenges."}
                </h2>
                <p>
                  {room.phase === "post"
                    ? "Your Pre-AI categories are selected automatically for a fair comparison."
                    : "Each challenge stands on its own. Choose three that reflect your everyday work."}{" "}
                  Your timer started at confirmed join. You can reload and
                  resume; elapsed time keeps running.
                </p>
                <strong>
                  {room.mode === "single"
                    ? "Each challenge has a download pack, four questions and one file to upload."
                    : room.phase === "pre"
                      ? "Work without generative AI during the baseline."
                      : "AI tools are permitted. Describe how you used them in your method notes."}
                </strong>
              </div>
            </section>
            <div className="challenge-grid">
              {tasks.map((t, i) => (
                <button
                  key={t.id}
                  className={
                    "challenge-card " +
                    (selected.includes(t.id) ? "selected" : "")
                  }
                  aria-pressed={selected.includes(t.id)}
                  disabled={
                    room.phase === "post" ||
                    (!selected.includes(t.id) && selected.length === 3)
                  }
                  onClick={() =>
                    setSelected((v) =>
                      v.includes(t.id)
                        ? v.filter((x) => x !== t.id)
                        : [...v, t.id],
                    )
                  }
                >
                  <div className="challenge-top">
                    <span className={"task-number tone-" + i}>0{i + 1}</span>
                    <span className="check-circle">
                      {selected.includes(t.id) && <Check size={14} />}
                    </span>
                  </div>
                  <span className="eyebrow">{t.tool}</span>
                  <h3>{t.title}</h3>
                  <p>{t.subtitle}</p>
                  <small>4 result questions · Evidence upload</small>
                </button>
              ))}
            </div>
            <div className="start-bar">
              <div>
                <strong>{selected.length} of 3 challenges selected</strong>
                <p>Selections lock when you begin. Make sure you’re ready.</p>
              </div>
              <button
                className="button primary"
                disabled={
                  selected.length !== 3 || busy || locked || room.closed
                }
                onClick={() => void start()}
              >
                Confirm selected challenges <ArrowRight size={18} />
              </button>
            </div>
          </>
        ) : (
          <div className="assessment-layout">
            <section>
              <div
                className="task-tabs"
                role="tablist"
                aria-label="Selected challenges"
              >
                {p.selected.map((t, i) => (
                  <button
                    role="tab"
                    aria-selected={active === t}
                    key={t}
                    onClick={() => setActive(t)}
                  >
                    <span>
                      {draft.completed.includes(t) ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </span>
                    {tasks.find((x) => x.id === t)?.title}
                  </button>
                ))}
              </div>
              <div className="panel task-panel">
                <span className="eyebrow">{task.tool}</span>
                <h2>{task.title}</h2>
                <p className="task-brief">{task.brief}</p>
                <DownloadLink href={"/api/" + base + "/materials/" + active}>
                  <Download size={16} />{" "}
                  {room.mode === "single"
                    ? "Download source materials"
                    : `Download ${room.phase.toUpperCase()}-AI materials`}
                </DownloadLink>
                <div className="deliverables">
                  <h3>What to submit</h3>
                  <ul>
                    {task.deliverables.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  <p className="help">
                    Practical evaluation: {task.rubric.join(" · ")}
                  </p>
                </div>
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">SHOW WHAT YOU FOUND</span>
                    <h3>Result-based questions</h3>
                  </div>
                  <span className="pill">
                    4 questions ·{" "}
                    {p.scoringVersion === "corporate-60-v1" ? 12 : 4} marks
                  </span>
                </div>
                <fieldset disabled={locked || busy} className="questions">
                  {task.questions.map((q, index) => (
                    <fieldset key={active + index}>
                      <legend>
                        <span>{index + 1}</span>
                        {q.prompt}
                      </legend>
                      <div className="answer-options">
                        {q.options.map((option, optionIndex) => (
                          <label
                            className={
                              draft.answers[active]?.[index] === optionIndex
                                ? "chosen"
                                : ""
                            }
                            key={optionIndex}
                          >
                            <input
                              type="radio"
                              name={`${active}-${index}`}
                              checked={
                                draft.answers[active]?.[index] === optionIndex
                              }
                              onChange={() => {
                                const answers = [
                                  ...(draftRef.current.answers[active] || [
                                    -1, -1, -1, -1,
                                  ]),
                                ];
                                answers[index] = optionIndex;
                                edit({
                                  ...draftRef.current,
                                  answers: {
                                    ...draftRef.current.answers,
                                    [active]: answers,
                                  },
                                });
                              }}
                            />
                            {option}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </fieldset>
                <div className="evidence-section">
                  <div className="section-heading">
                    <div>
                      <h3>Your practical evidence</h3>
                      <p>Upload the work that supports your results.</p>
                    </div>
                    <span className="pill">
                      Up to {detail.evidenceLimitMB || 25} MiB / file
                    </span>
                  </div>
                  <label className={"upload-zone " + (busy ? "disabled" : "")}>
                    <FileUp size={25} />
                    <strong>
                      {busy ? "Please wait…" : "Choose a file to upload"}
                    </strong>
                    <span>
                      Excel, Word, PowerPoint, PDF, CSV, text or images
                    </span>
                    <input
                      aria-label="Upload evidence"
                      type="file"
                      accept=".xlsx,.docx,.pptx,.pdf,.csv,.txt,.png,.jpg,.jpeg"
                      disabled={busy || locked}
                      onChange={(e) => {
                        void upload(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {uploadStatus && (
                    <p className="help" role="status">
                      {uploadStatus}
                    </p>
                  )}
                  <p className="help">
                    If an upload is interrupted, select the same file again to
                    resume. Evidence is attached only after server verification.
                  </p>
                  {p.evidence
                    .filter((e) => e.task === active)
                    .map((e) => (
                      <div className="evidence-file" key={e.id}>
                        <CheckCircle2 size={17} />
                        <span>
                          {e.name}
                          <small>
                            {Math.ceil(e.size / 1024)} KB · Saved securely
                          </small>
                        </span>
                        <DownloadLink
                          href={
                            "/api/" +
                            base +
                            `/evidence/${e.id}?participant=${p.identity.id}`
                          }
                        >
                          Download
                        </DownloadLink>
                      </div>
                    ))}
                </div>
                <label htmlFor="method-notes">Method notes</label>
                <textarea
                  id="method-notes"
                  rows={4}
                  maxLength={5000}
                  placeholder="Explain your approach, assumptions and tools used…"
                  disabled={locked || busy}
                  value={draft.notes[active] || ""}
                  onChange={(e) =>
                    edit({
                      ...draftRef.current,
                      notes: {
                        ...draftRef.current.notes,
                        [active]: e.target.value,
                      },
                    })
                  }
                />
                <label className="complete-task">
                  <input
                    type="checkbox"
                    checked={draft.completed.includes(active)}
                    disabled={
                      locked ||
                      busy ||
                      !p.evidence.some((e) => e.task === active) ||
                      draft.answers[active]?.length !== 4 ||
                      draft.answers[active]?.some((x) => x < 0)
                    }
                    onChange={(e) =>
                      edit({
                        ...draftRef.current,
                        completed: e.target.checked
                          ? [...draftRef.current.completed, active]
                          : draftRef.current.completed.filter(
                              (x) => x !== active,
                            ),
                      })
                    }
                  />{" "}
                  Mark this challenge complete
                </label>
                <p className="help">
                  Answer all four questions and attach evidence to complete this
                  task.
                </p>
              </div>
            </section>
            <aside className="assessment-rail">
              <div
                className={
                  "timer-panel " + (remaining < 5 * 60000 ? "urgent" : "")
                }
              >
                <span>
                  <Clock3 size={17} /> TIME REMAINING
                </span>
                <strong aria-live="off">
                  {String(minutes).padStart(2, "0")}
                  <b>:</b>
                  {String(seconds).padStart(2, "0")}
                </strong>
                <p>
                  {locked
                    ? "Time has ended. Assessment locked."
                    : "Your timer continues if you close this page."}
                </p>
              </div>
              <div className="panel progress-panel">
                <h3>Your progress</h3>
                {p.selected.map((t) => (
                  <div className="progress-item" key={t}>
                    <span
                      className={
                        "check-circle " +
                        (draft.completed.includes(t) ? "done" : "")
                      }
                    >
                      {draft.completed.includes(t) && <Check size={12} />}
                    </span>
                    <span>
                      {tasks.find((x) => x.id === t)?.title}
                      <small>
                        {(draft.answers[t] || []).filter((x) => x >= 0).length}
                        /4 answers ·{" "}
                        {p.evidence.filter((e) => e.task === t).length} file(s)
                      </small>
                    </span>
                  </div>
                ))}
                <div className="progress-track">
                  <i
                    style={{ width: `${(draft.completed.length / 3) * 100}%` }}
                  />
                </div>
                <p className="help">
                  {draft.completed.length} of 3 challenges complete
                </p>
                <div className="save-status" role="status">
                  <Save size={14} />
                  {status}
                  {lastSaved && (
                    <small>
                      Last successful save:{" "}
                      {new Date(lastSaved).toLocaleTimeString()}
                    </small>
                  )}
                </div>
                {dirty && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void flush().catch(() => {})}
                  >
                    Retry saving now
                  </button>
                )}
                {blocked.current && (
                  <button
                    className="text-button"
                    onClick={() => {
                      if (
                        confirm(
                          "Reload the saved version? Copy unsaved notes before continuing.",
                        )
                      )
                        location.reload();
                    }}
                  >
                    Reload saved work
                  </button>
                )}
                <button
                  className="button primary full"
                  disabled={busy || locked || draft.completed.length !== 3}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await flush();
                      history.pushState(
                        null,
                        "",
                        "/attendee/attempt/" + id + "/review",
                      );
                      setConfirmSubmit(true);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Submit assessment <ArrowRight size={16} />
                </button>
                <p className="help">
                  <LockKeyhole size={12} /> Submission locks all answers and
                  evidence.
                </p>
              </div>
              <div className="rail-note">
                <ShieldCheck size={20} />
                <strong>Focus on the work.</strong>
                <p>
                  Changes save automatically. If a save fails, keep this page
                  open and retry.
                </p>
              </div>
            </aside>
          </div>
        ))}
      {confirmSubmit && !p.submittedAt && (
        <div className="submission-review">
          <section className="panel" aria-labelledby="submit-title">
            <LockKeyhole size={28} />
            <h2 id="submit-title">Review before submission</h2>
            <ul>
              {p.selected.map((t) => (
                <li key={t}>
                  <strong>{tasks.find((x) => x.id === t)?.title}</strong> ·{" "}
                  {(draft.answers[t] || []).filter((x) => x >= 0).length}/4
                  answers · {p.evidence.filter((e) => e.task === t).length}{" "}
                  evidence file(s) ·{" "}
                  {draft.completed.includes(t) ? "Complete" : "Incomplete"}
                </li>
              ))}
            </ul>
            <p>
              Your answers and uploaded evidence will be locked for evaluation.
              This action cannot be undone.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  history.replaceState(null, "", "/attendee/rooms/" + id);
                  setConfirmSubmit(false);
                }}
              >
                Keep working
              </button>
              <button
                className="button primary"
                disabled={busy || locked || draft.completed.length !== 3}
                onClick={() => void submit()}
              >
                {busy ? "Submitting…" : "Submit & lock assessment"}
              </button>
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}
