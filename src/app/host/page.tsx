"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  api,
  DownloadLink,
  Empty,
  ErrorBox,
  format,
  Loading,
  Shell,
  Stat,
  useIdentity,
} from "@/components/ui";
import { PrePostCharts } from "@/components/pre-post-charts";
import { metrics } from "@/lib/metrics";
import type { comparison } from "@/lib/assessment";
import type { Participant, Program, Room, TaskId } from "@/lib/types";
import type { publicTasks } from "@/lib/challenges";
type Pair = {
  identity: Participant["identity"];
  pre: ReturnType<typeof metrics>;
  post: ReturnType<typeof metrics>;
} & ReturnType<typeof comparison>;
type RoomData = {
  room: Room;
  participants: Participant[];
  tasks: ReturnType<typeof publicTasks>;
};
const roomLabel = (r: Room) =>
  r.mode === "single"
    ? `${r.company || r.name} · ${r.batch}`
    : `${r.company || r.name} · ${r.batch} · ${r.phase === "pre" ? "Base Camp" : "Summit"}`;
const state = (p: Participant) =>
  p.submittedAt
    ? p.submissionReason === "deadline"
      ? "Expired"
      : metrics(p).fullyGraded
        ? "Finalized"
        : "Awaiting evaluation"
    : "In progress";
export default function Host() {
  const { identity, error: authError, single } = useIdentity("host");
  const path = usePathname();
  const [rooms, setRooms] = useState<Room[]>([]),
    [records, setRecords] = useState<Record<string, RoomData>>({}),
    [pairs, setPairs] = useState<Record<string, Pair[]>>({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [updated, setUpdated] = useState("");
  const [company, setCompany] = useState(""),
    [cohort, setCohort] = useState(""),
    [requestId, setRequestId] = useState(""),
    [filter, setFilter] = useState(""),
    [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all");
  const [review, setReview] = useState<Participant | null>(null),
    [task, setTask] = useState<TaskId>("inbox"),
    [grade, setGrade] = useState({
      accuracy: 0,
      quality: 0,
      completeness: 0,
      feedback: "",
    });
  const [model, setModel] = useState({
    cycles: 12,
    rate: 1000,
    adoption: 70,
    investment: 25000,
  });
  const loading = useRef(false);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const x = await api<{ rooms: Room[] }>("rooms");
      const data: Record<string, RoomData> = {},
        comparisons: Record<string, Pair[]> = {};
      await Promise.all(
        x.rooms.map(async (r) => {
          data[r.id] = await api<RoomData>(`rooms/${r.id}/participants`);
          if (r.phase === "post")
            comparisons[r.id] = (
              await api<{ pairs: Pair[] }>(`rooms/${r.id}/comparisons`)
            ).pairs;
        }),
      );
      setRooms(x.rooms);
      setRecords(data);
      setPairs(comparisons);
      setUpdated(new Date().toISOString());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      loading.current = false;
    }
  }, []);
  useEffect(() => {
    if (!identity) return;
    void load();
    const interval = setInterval(() => void load(), 15000);
    return () => clearInterval(interval);
  }, [identity, load]);
  useEffect(() => {
    if (path.endsWith("/new")) {
      const draft = sessionStorage.getItem("te-program-draft");
      if (draft) {
        try {
          const x = JSON.parse(draft);
          setRequestId(x.requestId);
          setCompany(x.company);
          setCohort(x.cohort);
        } catch {
          setRequestId(crypto.randomUUID());
        }
      } else setRequestId(crypto.randomUUID());
    }
  }, [path]);
  const parts = path.split("/").filter(Boolean);
  const routeRoom = parts[1] === "rooms" ? parts[2] : "";
  const programRooms =
    parts[1] === "assessments" && parts[2] && parts[2] !== "new"
      ? rooms.filter((r) => r.programId === parts[2] || r.id === parts[2])
      : [];
  const filtered = rooms.filter((r) =>
    ((r.company || "") + " " + r.name + " " + r.batch)
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const room = routeRoom
    ? rooms.find((r) => r.id === routeRoom)
    : path.startsWith("/host/reports")
      ? filtered.find((r) => r.id === selected) || filtered[0]
      : rooms.find((r) => r.id === selected) || programRooms[0] || rooms[0];
  const data = room ? records[room.id] : null;
  const people = data?.participants || [];
  const isNew = path === "/host/assessments/new",
    isDashboard = path === "/host",
    isList = path === "/host/assessments",
    isDetail = programRooms.length > 0 && parts[1] === "assessments",
    isReports = parts[1] === "reports",
    // Single-round release has no comparison or modeled-ROI report; reports open the export.
    isExport = path === "/host/reports/export" || (single && isReports),
    isMonitor = parts[1] === "rooms",
    isGrade = parts[3] === "evaluate";
  useEffect(() => {
    setReview(null);
  }, [path]);
  const target = parts[4];
  useEffect(() => {
    if (!isGrade || !data || !target) return;
    const p = data.participants.find((p) => p.identity.id === target);
    if (p && !review) {
      setReview(p);
      const t = p.selected[0];
      if (t) {
        setTask(t);
        const g = p.grades[t];
        setGrade({
          accuracy: g?.accuracy || 0,
          quality: g?.quality || 0,
          completeness: g?.completeness || 0,
          feedback: g?.feedback || "",
        });
      }
    }
  }, [isGrade, data, target, review]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const input = { company: company.trim(), cohort: cohort.trim(), requestId };
    sessionStorage.setItem("te-program-draft", JSON.stringify(input));
    try {
      const x = await api<{ program: Program }>("programs", input);
      sessionStorage.removeItem("te-program-draft");
      location.assign("/host/assessments/" + x.program.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function close(r: Room) {
    setBusy(true);
    setError("");
    try {
      await api(`rooms/${r.id}/close`, { closed: !r.closed });
      await load();
      setNotice(r.closed ? "Room opened." : "Room closed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeTask(t: TaskId) {
    setTask(t);
    const g = review?.grades[t];
    setGrade({
      accuracy: g?.accuracy || 0,
      quality: g?.quality || 0,
      completeness: g?.completeness || 0,
      feedback: g?.feedback || "",
    });
  }
  async function saveGrade(e: React.FormEvent) {
    e.preventDefault();
    if (!room || !review) return;
    setBusy(true);
    setError("");
    try {
      const x = await api<{ participant: Participant }>(
        `rooms/${room.id}/grade`,
        {
          participantId: review.identity.id,
          task,
          expectedAt: review.grades[task]?.at ?? null,
          ...grade,
        },
      );
      setReview(x.participant);
      setNotice("Practical evaluation saved.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!identity)
    return authError ? <ErrorBox message={authError} /> : <Loading />;
  if (!updated && !isNew)
    return (
      <Shell identity={identity}>
        {error ? (
          <>
            <ErrorBox message={error} />
            <button className="button secondary" onClick={() => void load()}>
              Retry loading assessments
            </button>
          </>
        ) : (
          <Loading />
        )}
      </Shell>
    );
  const all = Object.values(records).flatMap((x) => x.participants),
    submitted = all.filter((p) => p.submittedAt),
    pending = submitted.filter((p) => !metrics(p).fullyGraded);
  const programs = filtered.filter(
    (r, i, a) =>
      !r.programId || a.findIndex((x) => x.programId === r.programId) === i,
  );
  const eligible = Object.entries(pairs)
    .filter(([id]) => filtered.some((r) => r.id === id))
    .flatMap(([, ps]) => ps)
    .filter((p) => p.comparable);
  const mean = (key: "minutesSaved" | "accuracyDelta" | "qualityDelta") =>
    eligible.length
      ? eligible.reduce((n, p) => n + (p[key] || 0), 0) / eligible.length
      : null;
  const visible = people.filter(
    (p) =>
      (p.identity.name + " " + p.identity.email)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "all" ||
        (status === "pending"
          ? !!p.submittedAt && !metrics(p).fullyGraded
          : state(p) === status)),
  );
  const capacity =
    ((eligible.reduce((n, p) => n + (p.minutesSaved || 0), 0) / 60) *
      model.cycles *
      model.rate *
      model.adoption) /
    100;
  const title = isNew
    ? single
      ? "Create an assessment room"
      : "Create a company assessment"
    : isDashboard
      ? "Assessment overview"
      : isList
        ? single
          ? "Assessment rooms"
          : "Assessments"
        : isDetail
          ? `${programRooms[0].company || programRooms[0].name} · ${programRooms[0].batch}`
          : isExport
            ? "Export assessment results"
            : isReports
              ? "Results & impact"
              : isGrade
                ? "Evaluate a submission"
                : "Live monitoring";
  return (
    <Shell identity={identity}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TECHNOEDGE LEARNING SERVICES</span>
          <h1>{title}</h1>
          <p>
            {isNew
              ? single
                ? "Enter the client company and cohort. One 60-minute room with the five fixed challenges is created."
                : "Enter the client company and cohort. Fixed challenges and two linked rooms are included."
              : isDashboard
                ? "Manage corporate cohorts, assessment progress and practical evaluations."
                : single
                  ? "One 60-minute assessment room per company cohort"
                  : "Company assessments · Base Camp and Summit"}
          </p>
        </div>
        {(isDashboard || isList) && (
          <Link className="button primary" href="/host/assessments/new">
            {single ? "+ Create room" : "+ Create assessment"}
          </Link>
        )}
      </div>
      <ErrorBox message={error} />
      {notice && (
        <div className="success" role="status">
          {notice}
          <button className="text-button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}
      {isNew && (
        <div className="corporate-columns">
          <form className="panel" onSubmit={create}>
            <h2>Program information</h2>
            <label htmlFor="company">Client company</label>
            <input
              id="company"
              value={company}
              minLength={2}
              maxLength={120}
              onChange={(e) => setCompany(e.target.value)}
              required
            />
            <label htmlFor="cohort">Batch / cohort name</label>
            <input
              id="cohort"
              value={cohort}
              minLength={2}
              maxLength={80}
              onChange={(e) => setCohort(e.target.value)}
              required
            />
            <div className="button-row">
              <Link href="/host/assessments" className="button secondary">
                Cancel
              </Link>
              <button className="button primary" disabled={busy || !requestId}>
                {busy
                  ? "Creating…"
                  : single
                    ? "Create assessment room"
                    : "Create program & two rooms"}
              </button>
            </div>
          </form>
          <section className="panel">
            <h2>Automatically included</h2>
            <ul>
              {single ? (
                <li>One room, open immediately, with its own room code</li>
              ) : (
                <>
                  <li>Base Camp — open initially</li>
                  <li>Summit — closed until you open it</li>
                </>
              )}
              <li>
                {single
                  ? "60 minutes, one attempt per participant"
                  : "60 minutes per round"}
              </li>
              <li>Five validated practical challenges; three required</li>
              <li>60 marks: 36 MCQ + 24 practical</li>
              {!single && (
                <li>Matched categories across different Pre/Post datasets</li>
              )}
              <li>
                Room codes, evaluations, Excel reports and evidence exports
              </li>
            </ul>
          </section>
        </div>
      )}
      {isDashboard && (
        <>
          <section className="stats-grid">
            <Stat
              label="Client cohorts"
              value={
                rooms.filter((r, i, a) =>
                  r.programId
                    ? a.findIndex((x) => x.programId === r.programId) === i
                    : true,
                ).length
              }
              detail="Includes historical standalone rooms"
            />
            <Stat
              label="Participants"
              value={new Set(all.map((p) => p.identity.id)).size}
              detail="Unique identities across your rooms"
            />
            <Stat
              label="Submitted attempts"
              value={submitted.length}
              detail={
                single
                  ? "Submitted or expired at the deadline"
                  : "Pre and Post combined, including expiry"
              }
            />
            <Stat
              label="Awaiting evaluation"
              value={pending.length}
              detail="Submitted attempts requiring practical marks"
            />
          </section>
          <section className="panel">
            <h2>Programs requiring attention</h2>
            {pending.length === 0 ? (
              <p>No practical evaluations are pending.</p>
            ) : (
              pending.map((p) => {
                const r = rooms.find((r) => r.id === p.roomId)!;
                return (
                  <div className="corporate-row" key={p.roomId + p.identity.id}>
                    <div>
                      <strong>{p.identity.name}</strong>
                      <p>{roomLabel(r)}</p>
                    </div>
                    <Link
                      className="button secondary"
                      href={`/host/rooms/${r.id}/evaluate/${p.identity.id}`}
                    >
                      Evaluate
                    </Link>
                  </div>
                );
              })
            )}
          </section>
          {single && (
            <section className="panel">
              <h2>Your rooms</h2>
              {programs.length === 0 && (
                <p>No rooms yet. Create a room to get a room code.</p>
              )}
              {programs.map((r) => {
                const ps = records[r.id]?.participants || [];
                return (
                  <div className="corporate-row" key={r.id}>
                    <div>
                      <strong>{roomLabel(r)}</strong>
                      <p>
                        {r.closed ? "Closed" : "Open"} · {ps.length} joined ·{" "}
                        {ps.filter((p) => !p.submittedAt).length} active ·{" "}
                        {
                          ps.filter(
                            (p) =>
                              p.submittedAt &&
                              p.submissionReason !== "deadline",
                          ).length
                        }{" "}
                        submitted ·{" "}
                        {
                          ps.filter((p) => p.submissionReason === "deadline")
                            .length
                        }{" "}
                        expired ·{" "}
                        {
                          ps.filter(
                            (p) => p.submittedAt && !metrics(p).fullyGraded,
                          ).length
                        }{" "}
                        to evaluate
                      </p>
                    </div>
                    <Link
                      className="button secondary"
                      href={"/host/assessments/" + (r.programId || r.id)}
                    >
                      Manage room
                    </Link>
                  </div>
                );
              })}
            </section>
          )}
          {!single && (
            <section className="panel">
              <h2>Pre/Post completion overview</h2>
              <p>
                {eligible.length} finalized, complete, matched pairs from{" "}
                {Object.values(pairs).flat().length} linked participant pairs.
              </p>
              <p>
                Reports exclude unfinished or ungraded pairs and pairs with
                different scoring versions.
              </p>
              <Link className="button secondary" href="/host/reports">
                See comparison report
              </Link>
            </section>
          )}
        </>
      )}
      {isList && (
        <>
          <label htmlFor="company-filter">Search company or cohort</label>
          <input
            id="company-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="room-grid">
            {programs.map((r) => (
              <article className="panel" key={r.id}>
                <h2>{r.company || r.name}</h2>
                <p>{r.batch}</p>
                <p>
                  {r.mode === "single"
                    ? "Single 60-minute assessment"
                    : r.programId
                      ? "Base Camp + Summit"
                      : "Historical standalone room"}
                </p>
                <Link
                  className="button secondary"
                  href={"/host/assessments/" + (r.programId || r.id)}
                >
                  Manage assessment
                </Link>
              </article>
            ))}
          </div>
        </>
      )}
      {isDetail && (
        <>
          <div className="room-grid">
            {programRooms.map((r) => (
              <article className="panel" key={r.id}>
                <span className={"pill " + (r.closed ? "lavender" : "mint")}>
                  {r.closed ? "Closed" : "Open"}
                </span>
                <h2>
                  {r.mode === "single"
                    ? "AI Productivity Assessment"
                    : r.phase === "pre"
                      ? "Base Camp — Before AI"
                      : "Summit — After AI"}
                </h2>
                <p>
                  {r.durationMinutes} minutes ·{" "}
                  {r.scoringVersion || "legacy-100"}
                </p>
                <label>Room code</label>
                <code className="room-code">{r.id}</code>
                <button
                  className="button secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(r.id);
                      setNotice("Room code copied.");
                    } catch {
                      setError(
                        "Copy unavailable. Select and copy the room code above.",
                      );
                    }
                  }}
                >
                  Copy code
                </button>
                <div className="button-row">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void close(r)}
                  >
                    {r.closed ? "Open room" : "Close room"}
                  </button>
                  <Link
                    className="button primary"
                    href={`/host/rooms/${r.id}/monitor`}
                  >
                    Monitor and evaluate
                  </Link>
                </div>
                <p>
                  {records[r.id]?.participants.length || 0} participants ·{" "}
                  {records[r.id]?.participants.filter(
                    (p) => p.submittedAt && !metrics(p).fullyGraded,
                  ).length || 0}{" "}
                  awaiting evaluation
                </p>
              </article>
            ))}
          </div>
          <section className="panel">
            <h2>Reports and evidence</h2>
            <div className="button-row">
              {!single && (
                <Link className="button secondary" href="/host/reports">
                  View results & impact
                </Link>
              )}
              <Link className="button secondary" href="/host/reports/export">
                Excel & evidence exports
              </Link>
            </div>
          </section>
        </>
      )}
      {isMonitor && !isGrade && room && (
        <>
          <p>
            <strong>{roomLabel(room)}</strong>
          </p>
          <section className="stats-grid">
            <Stat label="Joined" value={people.length} />
            <Stat
              label="In progress"
              value={people.filter((p) => !p.submittedAt).length}
            />
            <Stat
              label="Submitted"
              value={
                people.filter(
                  (p) => p.submittedAt && p.submissionReason !== "deadline",
                ).length
              }
            />
            <Stat
              label="Expired"
              value={
                people.filter((p) => p.submissionReason === "deadline").length
              }
            />
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Participant activity</h2>
              <button className="button secondary" onClick={() => void load()}>
                Refresh
              </button>
            </div>
            <p className="help">
              Last updated{" "}
              {updated ? new Date(updated).toLocaleTimeString() : "—"} ·
              refreshes every 15 seconds
            </p>
            <div className="corporate-filters">
              <label>
                Search participants
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                Status
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {[
                    "all",
                    "In progress",
                    "Awaiting evaluation",
                    "Finalized",
                    "Expired",
                    "pending",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>Status</th>
                    <th>Selected tasks</th>
                    <th>Deadline</th>
                    <th>Complete</th>
                    <th>Score</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.identity.id}>
                      <td>
                        <strong>{p.identity.name}</strong>
                        <br />
                        {p.identity.email}
                      </td>
                      <td>{state(p)}</td>
                      <td>{p.selected.join(", ") || "Choosing challenges"}</td>
                      <td>
                        {p.deadline
                          ? new Date(p.deadline).toLocaleTimeString()
                          : "—"}
                      </td>
                      <td>{metrics(p).completed}/3</td>
                      <td>
                        {format(metrics(p).score)} / {metrics(p).maximum}
                      </td>
                      <td>
                        {p.submittedAt && p.selected.length > 0 ? (
                          <Link
                            className="button secondary compact"
                            href={`/host/rooms/${room.id}/evaluate/${p.identity.id}`}
                          >
                            Evaluate
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {isGrade &&
        room &&
        (review ? (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>{review.identity.name}</h2>
                <p>
                  {review.identity.email} · {state(review)}
                </p>
              </div>
              <Link
                className="button secondary"
                href={`/host/rooms/${room.id}/monitor`}
              >
                Back to monitoring
              </Link>
            </div>
            <label htmlFor="evaluation-task">Challenge</label>
            <select
              id="evaluation-task"
              value={task}
              onChange={(e) => changeTask(e.target.value as TaskId)}
            >
              {review.selected.map((t) => (
                <option key={t} value={t}>
                  {data?.tasks.find((x) => x.id === t)?.title || t}
                </option>
              ))}
            </select>
            <div className="corporate-columns">
              <section>
                <h3>Practical evidence</h3>
                <p>
                  Correct MCQs: {review.mcq[task] || 0}/4 · awarded{" "}
                  {(review.mcq[task] || 0) *
                    (review.scoringVersion === "corporate-60-v1" ? 3 : 1)}{" "}
                  MCQ marks
                </p>
                {review.evidence
                  .filter((e) => e.task === task)
                  .map((e) => (
                    <p key={e.id}>
                      <DownloadLink
                        href={`/api/rooms/${room.id}/evidence/${e.id}?participant=${review.identity.id}`}
                      >
                        {e.name}
                      </DownloadLink>
                    </p>
                  ))}
                {!review.evidence.some((e) => e.task === task) && (
                  <p>No evidence received for this challenge.</p>
                )}
                <h3>Method notes</h3>
                <p className="preserve-lines">
                  {review.notes[task] || "No notes supplied."}
                </p>
              </section>
              <form onSubmit={saveGrade}>
                <h3>
                  Practical evaluation ·{" "}
                  {review.scoringVersion === "corporate-60-v1" ? 8 : 15} marks
                </h3>
                {(["completeness", "accuracy", "quality"] as const).map((k) => {
                  const max =
                    review.scoringVersion === "corporate-60-v1"
                      ? k === "quality"
                        ? 2
                        : 3
                      : 5;
                  return (
                    <label key={k}>
                      {k === "quality" &&
                      review.scoringVersion === "corporate-60-v1"
                        ? "Presentation"
                        : k}{" "}
                      /{max}
                      <input
                        type="number"
                        min={0}
                        max={max}
                        step={1}
                        value={grade[k]}
                        required
                        onChange={(e) =>
                          setGrade({ ...grade, [k]: Number(e.target.value) })
                        }
                      />
                    </label>
                  );
                })}
                <label>
                  Evaluator feedback
                  <textarea
                    required
                    minLength={3}
                    maxLength={5000}
                    value={grade.feedback}
                    onChange={(e) =>
                      setGrade({ ...grade, feedback: e.target.value })
                    }
                  />
                </label>
                <button className="button primary" disabled={busy}>
                  Save practical evaluation
                </button>
              </form>
            </div>
            <details>
              <summary>Evaluation audit history</summary>
              {review.gradingHistory?.map((g, i) => (
                <p key={i}>
                  {g.task} · {g.at} · {g.graderId} ·{" "}
                  {g.completeness + g.accuracy + g.quality} marks · {g.feedback}
                </p>
              ))}
            </details>
          </section>
        ) : (
          <Empty
            title="Submission unavailable"
            detail="Choose a submitted participant from live monitoring."
          />
        ))}
      {isReports && (
        <>
          <label htmlFor="report-filter">
            Company / cohort filter
            <input
              id="report-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          {isExport ? (
            <section className="panel">
              <h2>{single ? "Export a room" : "Export a round"}</h2>
              <label>
                Assessment round
                <select
                  aria-label="Assessment round"
                  value={room?.id || ""}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {filtered.map((r) => (
                    <option key={r.id} value={r.id}>
                      {roomLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                {single
                  ? "The Excel workbook has six sheets: Participants, Question Answers, Challenge Results, Overall Results, Evidence Log and Data Dictionary. Totals show Pending until every practical evaluation is recorded."
                  : "Excel includes identity, answers, scoring version and maximum, practical marks, timestamps, evidence index and eligible Pre/Post comparisons. Reports are archived as snapshots."}
              </p>
              {room && (
                <div className="button-row">
                  <DownloadLink href={`/api/rooms/${room.id}/export`}>
                    Download Excel report
                  </DownloadLink>
                  <DownloadLink href={`/api/rooms/${room.id}/evidence-zip`}>
                    Download evidence ZIP
                  </DownloadLink>
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="stats-grid">
                <Stat
                  label="Eligible paired participants"
                  value={eligible.length}
                  detail="Both rounds complete and finalized; same scoring version"
                />
                <Stat
                  label="Elapsed minutes saved"
                  value={format(mean("minutesSaved"))}
                  detail="Mean Pre minus Post elapsed assessment time"
                />
                <Stat
                  label="Accuracy improvement"
                  value={format(mean("accuracyDelta"), " pp")}
                  detail="Percentage-point difference in MCQ accuracy"
                />
                <Stat
                  label="Presentation improvement"
                  value={format(mean("qualityDelta"), " pp")}
                  detail="Percentage-point difference in rubric quality"
                />
              </section>
              <section className="panel">
                <h2>Observed assessment results</h2>
                <p>
                  Score changes below are marks on each pair’s original scale.
                  Elapsed time is measured from confirmed join to submission.
                  These differences do not establish causation or realized
                  financial savings.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Participant</th>
                        <th>Scoring version</th>
                        <th>Pre score</th>
                        <th>Post score</th>
                        <th>Change</th>
                        <th>Minutes saved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligible.map((p, i) => (
                        <tr key={i}>
                          <td>{p.identity.name}</td>
                          <td>{p.pre.scoringVersion}</td>
                          <td>
                            {p.pre.score}/{p.pre.maximum}
                          </td>
                          <td>
                            {p.post.score}/{p.post.maximum}
                          </td>
                          <td>{format(p.scoreDelta)} marks</td>
                          <td>{format(p.minutesSaved)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!eligible.length && (
                  <p>No complete, finalized pairs match this filter.</p>
                )}
              </section>
              {eligible[0] && (
                <PrePostCharts pre={eligible[0].pre} post={eligible[0].post} />
              )}
              <section className="panel">
                <h2>Modeled financial ROI</h2>
                <p>
                  Capacity value from eligible participants and your
                  assumptions. This is separate from observed results and is not
                  cash savings.
                </p>
                <div className="corporate-filters">
                  {(["cycles", "rate", "adoption", "investment"] as const).map(
                    (k) => (
                      <label key={k}>
                        {
                          {
                            cycles: "Repetitions per year",
                            rate: "Loaded hourly cost (INR)",
                            adoption: "Realization assumption (%)",
                            investment: "Training investment (INR)",
                          }[k]
                        }
                        <input
                          type="number"
                          min={0}
                          max={k === "adoption" ? 100 : 10000000}
                          value={model[k]}
                          onChange={(e) =>
                            setModel({
                              ...model,
                              [k]: Math.max(
                                0,
                                Math.min(
                                  k === "adoption" ? 100 : 10000000,
                                  Number(e.target.value),
                                ),
                              ),
                            })
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
                <p>
                  Modeled annual capacity: INR {format(capacity)} · modeled ROI:{" "}
                  {model.investment > 0
                    ? format(
                        ((capacity - model.investment) / model.investment) *
                          100,
                        "% ",
                      )
                    : "Set an investment"}
                </p>
              </section>
              <Link className="button primary" href="/host/reports/export">
                Excel & evidence exports
              </Link>
            </>
          )}
        </>
      )}
    </Shell>
  );
}
