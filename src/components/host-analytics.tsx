"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  Hourglass,
  RefreshCw,
  Send,
  Timer,
  Users,
  Award,
} from "lucide-react";
import { DownloadLink, Empty, ErrorBox, Stat } from "@/components/ui";
import {
  analytics,
  type AttemptStatus,
  type RoomRecords,
  type StatusFilter,
} from "@/lib/analytics";

const fmt = (x: number | null, unit = "", digits = 1) =>
  x === null || !Number.isFinite(x)
    ? "—"
    : (Number.isInteger(x) ? String(x) : x.toFixed(digits)) + unit;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// One tooltip per chart: marks carry data-tip, the card follows the pointer
// or keyboard focus. Works for HTML and SVG marks alike.
function ChartCard({
  title,
  subtitle,
  wide,
  table,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  wide?: boolean;
  table: { head: string[]; rows: (string | number)[][] };
  empty?: string | false;
  children: React.ReactNode;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );
  const show = (target: EventTarget | null, x?: number, y?: number) => {
    const el = (target as Element | null)?.closest?.("[data-tip]");
    const card = (target as Element | null)?.closest?.(".viz-card");
    if (!el || !card) return setTip(null);
    const box = card.getBoundingClientRect(),
      mark = el.getBoundingClientRect();
    setTip({
      x: (x ?? mark.left + mark.width / 2) - box.left,
      y: (y ?? mark.top) - box.top,
      text: el.getAttribute("data-tip") || "",
    });
  };
  return (
    <figure
      className={"viz-card" + (wide ? " wide" : "")}
      onMouseMove={(e) => show(e.target, e.clientX, e.clientY)}
      onMouseLeave={() => setTip(null)}
      onFocus={(e) => show(e.target)}
      onBlur={() => setTip(null)}
    >
      <figcaption>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </figcaption>
      {empty ? <p className="viz-empty">{empty}</p> : children}
      {tip && (
        <div
          className="viz-tip"
          role="status"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      )}
      {!empty && (
        <details className="viz-table">
          <summary>Data table</summary>
          <table>
            <thead>
              <tr>
                {table.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}

// Horizontal bars: one series, value labelled at the bar end.
function Bars({
  items,
  max,
  unit = "",
  tone = "var(--series-1)",
}: {
  items: { label: string; value: number | null; tip: string }[];
  max: number;
  unit?: string;
  tone?: string;
}) {
  return (
    <div className="viz-bars">
      {items.map((x) => (
        <div className="viz-bar-row" key={x.label}>
          <span className="viz-label">{x.label}</span>
          <div className="viz-track">
            <i
              tabIndex={0}
              data-tip={x.tip}
              style={{
                width: `${max ? Math.max(0, Math.min(100, ((x.value || 0) / max) * 100)) : 0}%`,
                background: tone,
              }}
            />
          </div>
          <span className="viz-value">{fmt(x.value, unit)}</span>
        </div>
      ))}
    </div>
  );
}

// Vertical columns on a zero baseline (histograms, timeline).
function Columns({
  items,
  axis,
}: {
  items: { label: string; count: number; tip: string }[];
  axis: string;
}) {
  const max = Math.max(1, ...items.map((x) => x.count));
  return (
    <div className="viz-columns" aria-label={axis}>
      <div className="viz-col-plot">
        {items.map((x) => (
          <div className="viz-col" key={x.label}>
            <span className="viz-col-value">{x.count || ""}</span>
            <i
              tabIndex={0}
              data-tip={x.tip}
              style={{ height: `${(x.count / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="viz-col-labels">
        {items.map((x) => (
          <span key={x.label}>{x.label}</span>
        ))}
      </div>
      <small className="viz-axis">{axis}</small>
    </div>
  );
}

const STATUS: Record<AttemptStatus, { color: string; icon: React.ReactNode }> =
  {
    "In progress": { color: "var(--series-1)", icon: <Hourglass size={13} /> },
    "Awaiting evaluation": {
      color: "var(--status-warning)",
      icon: <AlertTriangle size={13} />,
    },
    Evaluated: {
      color: "var(--status-good)",
      icon: <CheckCircle2 size={13} />,
    },
  };
// Sequential blue ramp (light -> dark) for accuracy cells.
const RAMP = [
  "#cde2fb",
  "#b7d3f6",
  "#9ec5f4",
  "#86b6ef",
  "#6da7ec",
  "#5598e7",
  "#3987e5",
  "#2a78d6",
  "#256abf",
  "#1c5cab",
];
const rampFor = (rate: number) =>
  RAMP[Math.min(RAMP.length - 1, Math.floor((rate / 100) * RAMP.length))];

export function HostAnalytics({
  data,
  loaded,
  error,
  updated,
  onRefresh,
}: {
  data: RoomRecords[];
  loaded: boolean;
  error: string;
  updated: string;
  onRefresh: () => void;
}) {
  const [roomId, setRoomId] = useState("all"),
    [status, setStatus] = useState<StatusFilter>("all");
  const a = useMemo(
    () => analytics(data, { roomId, status }),
    [data, roomId, status],
  );
  const stale =
    !!updated && Date.now() - Date.parse(updated) > 60000 && !!error;
  if (!loaded && !error)
    return (
      <div className="viz-root" aria-busy="true">
        <div className="viz-skeleton" />
      </div>
    );
  const k = a.kpis;
  const none = a.rows.length === 0;
  const roomOptions = data.map((d) => ({
    id: d.room.id,
    label: `${d.room.company || d.room.name} · ${d.room.batch}`,
  }));
  const maxScore = 60;
  return (
    <div className="viz-root">
      <div className="viz-filters" role="group" aria-label="Dashboard filters">
        <label>
          Room
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="all">All rooms ({data.length})</option>
            {roomOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="all">All participants</option>
            <option>In progress</option>
            <option>Awaiting evaluation</option>
            <option>Evaluated</option>
            <option>Ended at deadline</option>
          </select>
        </label>
        <span className={"viz-updated" + (stale ? " stale" : "")}>
          {stale ? <AlertTriangle size={13} /> : <Clock3 size={13} />}
          {updated
            ? `${stale ? "Stale · last updated" : "Updated"} ${new Date(updated).toLocaleTimeString("en-IN")}`
            : "Not loaded"}
        </span>
        <button className="button secondary" onClick={onRefresh}>
          <RefreshCw size={14} /> Refresh
        </button>
        {roomId === "all" ? (
          <Link className="button secondary" href="/host/reports/export">
            <FileSpreadsheet size={14} /> Excel export
          </Link>
        ) : (
          <DownloadLink href={`/api/rooms/${roomId}/export`}>
            <FileSpreadsheet size={14} /> Download Excel
          </DownloadLink>
        )}
      </div>
      {error && (
        <ErrorBox
          message={`Could not refresh: ${error}. Showing the last loaded data.`}
        />
      )}
      <section className="viz-kpis" aria-label="Key figures">
        <Stat
          label="Participants"
          value={k.participants}
          detail={`${k.attempts} attempt(s) in the selection`}
          icon={<Users size={17} />}
        />
        <Stat
          label="Submitted"
          value={k.submitted}
          detail={`${fmt(k.completionRate, "%")} completion · ${k.atDeadline} at deadline`}
          icon={<Send size={17} />}
        />
        <Stat
          label="Pending evaluation"
          value={k.pending}
          detail="Submitted, practical marks outstanding"
          icon={<AlertTriangle size={17} />}
        />
        <Stat
          label="Evaluated"
          value={k.evaluated}
          detail="All three practical marks recorded"
          icon={<CheckCircle2 size={17} />}
        />
        <Stat
          label="Average score"
          value={k.averageScore === null ? "—" : `${fmt(k.averageScore)} / 60`}
          detail={
            k.averageScore === null
              ? "Shown once an attempt is evaluated"
              : `${fmt((k.averageScore / 60) * 100, "%")} across evaluated attempts`
          }
          icon={<Award size={17} />}
        />
        <Stat
          label="Average time"
          value={
            k.averageMinutes !== null && k.averageMinutes < 1
              ? "< 1 min"
              : fmt(k.averageMinutes, " min")
          }
          detail="Confirmed join to submission"
          icon={<Timer size={17} />}
        />
      </section>
      {none ? (
        <Empty
          title="No participants match these filters"
          detail="Share a room code with participants, or change the room or status filter."
        />
      ) : (
        <div className="viz-grid">
          <ChartCard
            title="Participation funnel"
            subtitle="Attempts at each stage"
            table={{
              head: ["Stage", "Attempts"],
              rows: a.funnel.map((x) => [x.label, x.count]),
            }}
          >
            <Bars
              items={a.funnel.map((x) => ({
                label: x.label,
                value: x.count,
                tip: `${x.label}: ${x.count} of ${a.funnel[0].count}`,
              }))}
              max={Math.max(1, a.funnel[0].count)}
            />
          </ChartCard>
          <ChartCard
            title="Attempt status"
            subtitle="Where every attempt stands now"
            table={{
              head: ["Status", "Attempts"],
              rows: a.status.map((x) => [x.label, x.count]),
            }}
          >
            <div className="viz-bars">
              {a.status.map((x) => (
                <div className="viz-bar-row" key={x.label}>
                  <span className="viz-label viz-status">
                    {STATUS[x.label].icon}
                    {x.label}
                  </span>
                  <div className="viz-track">
                    <i
                      tabIndex={0}
                      data-tip={`${x.label}: ${x.count}`}
                      style={{
                        width: `${(x.count / Math.max(1, a.rows.length)) * 100}%`,
                        background: STATUS[x.label].color,
                      }}
                    />
                  </div>
                  <span className="viz-value">{x.count}</span>
                </div>
              ))}
            </div>
          </ChartCard>
          <ChartCard
            title="Score distribution"
            subtitle="Evaluated attempts by final score (out of 60)"
            empty={
              a.scoreBins.every((b) => !b.count) &&
              "No evaluated attempts yet. Scores appear after all three practical marks are saved."
            }
            table={{
              head: ["Score band", "Attempts"],
              rows: a.scoreBins.map((x) => [x.label, x.count]),
            }}
          >
            <Columns
              axis="Final score (marks)"
              items={a.scoreBins.map((x) => ({
                ...x,
                tip: `${x.label} marks: ${x.count} attempt(s)`,
              }))}
            />
          </ChartCard>
          <ChartCard
            title="Average marks by challenge"
            subtitle="MCQ (of 12) and practical (of 8) per challenge, submitted attempts"
            table={{
              head: [
                "Challenge",
                "Submitted",
                "Avg MCQ /12",
                "Avg practical /8",
              ],
              rows: a.challenges.map((c) => [
                c.label,
                c.submitted,
                fmt(c.averageMcq),
                fmt(c.averagePractical),
              ]),
            }}
            empty={
              a.challenges.every((c) => !c.submitted) &&
              "No submitted attempts yet."
            }
          >
            <div className="viz-legend">
              <span>
                <i style={{ background: "var(--series-1)" }} /> MCQ
              </span>
              <span>
                <i style={{ background: "var(--series-2)" }} /> Practical
              </span>
            </div>
            <div className="viz-bars">
              {a.challenges.map((c) => (
                <div className="viz-bar-row" key={c.task}>
                  <span className="viz-label">{c.label}</span>
                  <div className="viz-track stacked">
                    <i
                      tabIndex={0}
                      data-tip={`${c.label} · MCQ ${fmt(c.averageMcq)} / 12 (${c.submitted} submitted)`}
                      style={{
                        width: `${((c.averageMcq || 0) / 20) * 100}%`,
                        background: "var(--series-1)",
                      }}
                    />
                    <i
                      tabIndex={0}
                      data-tip={`${c.label} · practical ${fmt(c.averagePractical)} / 8`}
                      style={{
                        width: `${((c.averagePractical || 0) / 20) * 100}%`,
                        background: "var(--series-2)",
                      }}
                    />
                  </div>
                  <span className="viz-value">
                    {c.submitted
                      ? fmt((c.averageMcq || 0) + (c.averagePractical || 0)) +
                        " / 20"
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          </ChartCard>
          <ChartCard
            title="Challenge selection"
            subtitle="How many attempts chose each challenge"
            table={{
              head: ["Challenge", "Chosen by"],
              rows: a.challenges.map((c) => [c.label, c.selections]),
            }}
          >
            <Bars
              items={a.challenges.map((c) => ({
                label: c.label,
                value: c.selections,
                tip: `${c.label}: chosen in ${c.selections} attempt(s)`,
              }))}
              max={Math.max(1, ...a.challenges.map((c) => c.selections))}
            />
          </ChartCard>
          <ChartCard
            title="Evidence coverage"
            subtitle="Submitted challenges with an uploaded file"
            table={{
              head: ["Challenge", "Submitted", "With evidence %"],
              rows: a.challenges.map((c) => [
                c.label,
                c.submitted,
                fmt(c.evidenceRate, "%"),
              ]),
            }}
            empty={
              a.challenges.every((c) => !c.submitted) &&
              "No submitted attempts yet."
            }
          >
            <Bars
              items={a.challenges.map((c) => ({
                label: c.label,
                value: c.evidenceRate,
                tip: `${c.label}: ${fmt(c.evidenceRate, "%")} of ${c.submitted} submitted had evidence`,
              }))}
              max={100}
              unit="%"
            />
          </ChartCard>
          <ChartCard
            wide
            title="Question accuracy"
            subtitle="Share of submitted answers that were correct, per question"
            table={{
              head: ["Challenge", "Q1", "Q2", "Q3", "Q4"],
              rows: a.questionAccuracy.map((c) => [
                c.label,
                ...c.questions.map((q) =>
                  q.answered ? `${q.rate}% (${q.correct}/${q.answered})` : "—",
                ),
              ]),
            }}
            empty={
              a.questionAccuracy.every((c) =>
                c.questions.every((q) => !q.answered),
              ) && "No submitted answers yet."
            }
          >
            <div className="viz-heat" role="grid">
              <span />
              {["Q1", "Q2", "Q3", "Q4"].map((q) => (
                <span key={q} className="viz-heat-head">
                  {q}
                </span>
              ))}
              {a.questionAccuracy.map((c) => (
                <div className="viz-heat-row" key={c.task} role="row">
                  <span className="viz-label">{c.label}</span>
                  {c.questions.map((q, i) => (
                    <span
                      key={i}
                      role="gridcell"
                      tabIndex={0}
                      className={"viz-cell" + (q.answered ? "" : " none")}
                      data-tip={
                        q.answered
                          ? `${c.label} Q${i + 1}: ${q.correct} of ${q.answered} correct`
                          : `${c.label} Q${i + 1}: no submitted answers`
                      }
                      style={
                        q.answered
                          ? {
                              background: rampFor(q.rate!),
                              color: q.rate! >= 60 ? "#fff" : "var(--text)",
                            }
                          : undefined
                      }
                    >
                      {q.answered ? `${Math.round(q.rate!)}%` : "—"}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <div className="viz-ramp" aria-hidden="true">
              <span>0%</span>
              <i
                style={{
                  background: `linear-gradient(90deg, ${RAMP[0]}, ${RAMP.at(-1)})`,
                }}
              />
              <span>100%</span>
            </div>
          </ChartCard>
          <ChartCard
            title="Practical rubric"
            subtitle="Average host marks as a share of each maximum"
            table={{
              head: ["Dimension", "Average", "Maximum", "%"],
              rows: a.rubric.map((r) => [
                r.label,
                fmt(r.average),
                r.max,
                fmt(r.percent, "%"),
              ]),
            }}
            empty={
              a.rubric.every((r) => r.average === null) &&
              "No practical evaluations saved yet."
            }
          >
            <Bars
              items={a.rubric.map((r) => ({
                label: `${r.label} (/${r.max})`,
                value: r.percent,
                tip: `${r.label}: ${fmt(r.average)} of ${r.max}`,
              }))}
              max={100}
              unit="%"
            />
            <small className="viz-note">
              Excludes automatic zeros for challenges with no evidence.
            </small>
          </ChartCard>
          <ChartCard
            title="Time taken"
            subtitle="Submitted attempts by minutes used (60-minute limit)"
            table={{
              head: ["Minutes", "Attempts"],
              rows: a.durationBins.map((x) => [x.label, x.count]),
            }}
            empty={
              a.durationBins.every((b) => !b.count) &&
              "No submitted attempts yet."
            }
          >
            <Columns
              axis="Minutes from join to submission"
              items={a.durationBins.map((x) => ({
                ...x,
                tip: `${x.label} min: ${x.count} attempt(s)`,
              }))}
            />
          </ChartCard>
          <ChartCard
            title="Submissions over time"
            subtitle={`Submitted attempts per ${a.timelineUnit} (your local time)`}
            table={{
              head: [a.timelineUnit === "hour" ? "Hour" : "Day", "Submitted"],
              rows: a.timeline.map((x) => [x.label, x.count]),
            }}
            empty={!a.timeline.length && "No submissions yet."}
          >
            <Columns
              axis={a.timelineUnit === "hour" ? "Hour of day" : "Date"}
              items={a.timeline.map((x) => ({
                ...x,
                tip: `${x.label}: ${x.count} submitted`,
              }))}
            />
          </ChartCard>
          <ChartCard
            title="Rooms compared"
            subtitle="Average final score per room (out of 60)"
            table={{
              head: ["Room", "Attempts", "Evaluated", "Avg score /60"],
              rows: a.roomsSummary.map((r) => [
                r.label,
                r.participants,
                r.evaluated,
                fmt(r.averageScore),
              ]),
            }}
            empty={
              a.roomsSummary.every((r) => r.averageScore === null) &&
              "No evaluated attempts yet."
            }
          >
            <Bars
              items={a.roomsSummary.map((r) => ({
                label: r.label,
                value: r.averageScore,
                tip: `${r.label}: ${fmt(r.averageScore)} / 60 across ${r.evaluated} evaluated`,
              }))}
              max={maxScore}
            />
          </ChartCard>
          <ChartCard
            title="Score and time"
            subtitle="Each dot is one evaluated attempt"
            table={{
              head: ["Participant", "Minutes", "Score /60"],
              rows: a.scatter.map((s) => [s.name, s.minutes, s.score]),
            }}
            empty={!a.scatter.length && "No evaluated attempts yet."}
          >
            <svg
              className="viz-scatter"
              viewBox="0 0 320 190"
              role="img"
              aria-label="Score against minutes taken"
            >
              {[0, 20, 40, 60].map((y) => (
                <g key={y}>
                  <line
                    x1="34"
                    x2="312"
                    y1={170 - (y / 60) * 150}
                    y2={170 - (y / 60) * 150}
                    className="grid"
                  />
                  <text x="28" y={174 - (y / 60) * 150} textAnchor="end">
                    {y}
                  </text>
                </g>
              ))}
              {[0, 15, 30, 45, 60].map((x) => (
                <text
                  key={x}
                  x={34 + (x / 60) * 278}
                  y="186"
                  textAnchor="middle"
                >
                  {x}
                </text>
              ))}
              {a.scatter.map((s, i) => (
                <circle
                  key={i}
                  tabIndex={0}
                  cx={34 + (Math.min(60, s.minutes) / 60) * 278}
                  cy={170 - (s.score / 60) * 150}
                  r="5"
                  data-tip={`${s.name}: ${s.score}/60 in ${s.minutes} min`}
                />
              ))}
            </svg>
            <small className="viz-axis">
              Minutes taken (x) · final score (y)
            </small>
          </ChartCard>
          <ChartCard
            title="Pending evaluations"
            subtitle="Oldest submission first"
            table={{
              head: ["Participant", "Room", "Submitted"],
              rows: a.queue.map((r) => [
                r.participant.identity.name,
                `${r.room.company || r.room.name} · ${r.room.batch}`,
                when(r.participant.submittedAt!),
              ]),
            }}
            empty={
              !a.queue.length &&
              "Nothing waiting. All submitted attempts are evaluated."
            }
          >
            <ul className="viz-list">
              {a.queue.slice(0, 6).map((r) => (
                <li key={r.room.id + r.participant.identity.id}>
                  <div>
                    <strong>{r.participant.identity.name}</strong>
                    <small>
                      {r.room.company || r.room.name} · {r.room.batch} ·{" "}
                      {when(r.participant.submittedAt!)}
                    </small>
                  </div>
                  <Link
                    className="button secondary"
                    href={`/host/rooms/${r.room.id}/evaluate/${r.participant.identity.id}`}
                  >
                    Evaluate
                  </Link>
                </li>
              ))}
            </ul>
            {a.queue.length > 6 && (
              <small className="viz-note">
                +{a.queue.length - 6} more in the data table.
              </small>
            )}
          </ChartCard>
          <ChartCard
            wide
            title="Recent submissions"
            subtitle="Latest eight submitted attempts"
            table={{
              head: ["Participant", "Room", "Submitted", "Status", "Score"],
              rows: a.recent.map((r) => [
                r.participant.identity.name,
                `${r.room.company || r.room.name} · ${r.room.batch}`,
                when(r.participant.submittedAt!),
                r.status,
                r.score === null ? "Pending" : `${r.score} / 60`,
              ]),
            }}
            empty={!a.recent.length && "No submissions yet."}
          >
            <div className="table-scroll">
              <table className="viz-recent">
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>Room</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {a.recent.map((r) => (
                    <tr key={r.room.id + r.participant.identity.id}>
                      <td>{r.participant.identity.name}</td>
                      <td>
                        {r.room.company || r.room.name} · {r.room.batch}
                      </td>
                      <td>
                        {when(r.participant.submittedAt!)}
                        {r.participant.submissionReason === "deadline" &&
                          " · at deadline"}
                      </td>
                      <td>
                        <span className="viz-status">
                          {STATUS[r.status].icon}
                          {r.status}
                        </span>
                      </td>
                      <td>
                        {r.score === null ? "Pending" : `${r.score} / 60`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      )}
    </div>
  );
}
