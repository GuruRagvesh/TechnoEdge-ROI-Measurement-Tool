"use client";
import {
  Award,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Hourglass,
  Info,
  ListChecks,
  Target,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";

export const NA = "Not available";
export const fmt = (x: number | null | undefined, unit = "") =>
  x === null || x === undefined || !Number.isFinite(x)
    ? NA
    : (Number.isInteger(x) ? String(x) : x.toFixed(1)) + unit;

function Tile({
  label,
  icon,
  value,
  detail,
  definition,
  tone,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  detail: ReactNode;
  definition: string;
  tone?: "lead";
}) {
  const missing = value === NA;
  return (
    <div className={"sc-tile" + (tone ? " sc-" + tone : "")}>
      <div className="sc-label">
        <span>{label}</span>
        <span className="sc-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <strong className={missing ? "sc-na" : ""}>{value}</strong>
      <small>{detail}</small>
      <span className="sc-def" title={definition}>
        <Info size={12} aria-hidden="true" />
        <span>{definition}</span>
      </span>
    </div>
  );
}

// The four headline figures. Score and MCQ accuracy are deliberately separate:
// the score includes practical evaluation, accuracy is MCQs only.
export function PrimaryMetrics(props: {
  score: number | null;
  maximum: number;
  scoreDetail: string;
  attempted: number | null;
  attemptedDetail: string;
  minutes: number | null;
  minutesDetail: string;
  accuracy: number | null;
  accuracyDetail: string;
}) {
  return (
    <section className="sc-primary" aria-label="Headline results">
      <Tile
        tone="lead"
        label="Current score"
        icon={<Award size={16} />}
        value={
          props.score === null ? (
            NA
          ) : (
            <>
              {fmt(props.score)}
              <em> / {props.maximum}</em>
            </>
          )
        }
        detail={props.scoreDetail}
        definition={`MCQ marks (3 per correct answer, max 36) + practical evaluation (max 24). Shown once all three challenges are evaluated.`}
      />
      <Tile
        label="Challenges attempted"
        icon={<ListChecks size={16} />}
        value={
          props.attempted === null ? (
            NA
          ) : (
            <>
              {fmt(props.attempted)}
              <em> / 5</em>
            </>
          )
        }
        detail={props.attemptedDetail}
        definition="Challenges selected out of the five available. Every participant chooses three."
      />
      <Tile
        label="Time taken"
        icon={<Clock3 size={16} />}
        value={
          props.minutes === null ? (
            NA
          ) : props.minutes < 1 ? (
            "< 1 min"
          ) : (
            <>
              {fmt(props.minutes)}
              <em> min</em>
            </>
          )
        }
        detail={props.minutesDetail}
        definition="From confirmed room entry to submission (or the 60-minute deadline), using server timestamps."
      />
      <Tile
        label="MCQ accuracy"
        icon={<Target size={16} />}
        value={fmt(props.accuracy, "%")}
        detail={props.accuracyDetail}
        definition="Correct MCQ answers ÷ MCQs answered, after submission. Practical marks are not included."
      />
    </section>
  );
}

export function PrePostPanel({
  pre,
  post,
  improvement,
  maximum = 60,
  detail,
}: {
  pre: number | null;
  post: number | null;
  improvement: number | null;
  maximum?: number;
  detail: string;
}) {
  const available = pre !== null && post !== null;
  const ticks = [0, 15, 30, 45, 60].map((t) => (t / 60) * maximum);
  const bar = (label: string, value: number | null, cls: string) => (
    <div className="sc-pp-row">
      <span>{label}</span>
      <div className="sc-pp-track">
        {value !== null && (
          <i
            className={cls}
            style={{ width: `${(value / maximum) * 100}%` }}
            title={`${label}: ${value} / ${maximum}`}
          />
        )}
      </div>
      <b>{value === null ? "—" : `${fmt(value)}/${maximum}`}</b>
    </div>
  );
  return (
    <section
      className={"sc-prepost panel" + (available ? "" : " sc-pp-empty")}
      aria-labelledby="prepost-title"
    >
      <div className="sc-pp-head">
        <div>
          <h2 id="prepost-title">
            <TrendingUp size={18} aria-hidden="true" /> Pre-Test vs Post-Test
          </h2>
          <p>{detail}</p>
        </div>
      </div>
      <div className="sc-pp-body">
        <dl className="sc-pp-figures">
          <div>
            <dt>Pre-Test</dt>
            <dd className={pre === null ? "sc-na" : ""}>
              {pre === null ? NA : `${fmt(pre)} / ${maximum}`}
            </dd>
          </div>
          <div>
            <dt>Post-Test</dt>
            <dd className={post === null ? "sc-na" : ""}>
              {post === null ? NA : `${fmt(post)} / ${maximum}`}
            </dd>
          </div>
          <div>
            <dt>Improvement</dt>
            <dd className={improvement === null ? "sc-na" : "sc-delta"}>
              {improvement === null
                ? NA
                : `${improvement > 0 ? "+" : ""}${fmt(improvement)} marks`}
            </dd>
          </div>
        </dl>
        <div className="sc-pp-chart" aria-hidden={!available}>
          {bar("Pre-Test", pre, "pre")}
          {bar("Post-Test", post, "post")}
          <div className="sc-pp-axis">
            {ticks.map((t) => (
              <span key={t}>{fmt(t)}</span>
            ))}
          </div>
          {!available && (
            <p className="sc-pp-note">
              Shown when the same participant has an evaluated Pre-Test and
              Post-Test. No results are estimated.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function SecondaryMetrics({
  items,
}: {
  items: { label: string; value: ReactNode; detail?: ReactNode }[];
}) {
  const icons = [
    <Hourglass key="s" size={15} />,
    <CheckCircle2 key="e" size={15} />,
    <FileCheck2 key="f" size={15} />,
    <ListChecks key="c" size={15} />,
  ];
  return (
    <section className="sc-secondary" aria-label="Status">
      {items.map((x, i) => (
        <div key={x.label}>
          <span className="sc-label">
            <span>{x.label}</span>
            <span className="sc-icon" aria-hidden="true">
              {icons[i]}
            </span>
          </span>
          <strong>{x.value}</strong>
          {x.detail && <small>{x.detail}</small>}
        </div>
      ))}
    </section>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "Evaluated" || status === "Finalized"
      ? "good"
      : status === "Submitted" || status === "Pending"
        ? "warn"
        : status === "In progress"
          ? "info"
          : "muted";
  return <span className={"sc-pill " + tone}>{status}</span>;
}

export function Definitions() {
  return (
    <details className="sc-definitions">
      <summary>How these figures are calculated</summary>
      <ul>
        <li>
          <b>Current score /60</b>: MCQ marks (3 per correct answer, 12
          questions, max 36) plus practical evaluation (completeness 3,
          accuracy 3, presentation 2 per challenge, max 24). Shown only when
          all three challenges are evaluated.
        </li>
        <li>
          <b>MCQ accuracy</b>: correct MCQ answers ÷ MCQs answered. It does not
          include practical marks, so it can differ from the score percentage.
        </li>
        <li>
          <b>Time taken</b>: confirmed room entry to submission or deadline,
          from server timestamps.
        </li>
        <li>
          <b>Completion</b>: selected challenges marked complete ÷ 3.
          <b> Evidence</b>: challenges with a file the server verified.
        </li>
        <li>
          <b>Pre-Test / Post-Test</b>: only when the same participant completed
          both linked assessments with the same three challenges and both were
          evaluated. Otherwise &ldquo;Not available&rdquo;.
        </li>
        <li>
          All figures come from saved assessment records and match the Excel
          export.
        </li>
      </ul>
    </details>
  );
}

type ChallengeRow = {
  task: string;
  label: string;
  mcqMarks: number | null;
  practical: number | null;
  automaticZero?: boolean;
  total: number | null;
  evidence: string | null;
  completed: boolean;
};
// Challenge-wise results for one attempt.
export function ChallengeResults({
  rows,
  submitted,
}: {
  rows: ChallengeRow[];
  submitted: boolean;
}) {
  return (
    <section className="panel sc-table-panel" aria-labelledby="cw-title">
      <h2 id="cw-title">Challenge-wise performance</h2>
      {rows.length === 0 ? (
        <p className="help">No challenges selected yet.</p>
      ) : (
        <div className="sc-table-wrap">
          <table className="sc-table">
            <thead>
              <tr>
                <th>Challenge</th>
                <th>MCQ /12</th>
                <th>Practical /8</th>
                <th>Total /20</th>
                <th>Evidence</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.task}>
                  <td>{r.label}</td>
                  <td>{r.mcqMarks === null ? (submitted ? "—" : "After submission") : r.mcqMarks}</td>
                  <td>
                    {r.practical === null
                      ? submitted
                        ? "Pending"
                        : "—"
                      : r.practical + (r.automaticZero ? " (no evidence)" : "")}
                  </td>
                  <td>{r.total === null ? "—" : <b>{r.total}</b>}</td>
                  <td className="sc-file">
                    {r.evidence ? (
                      <span className="sc-ok">✓ {r.evidence}</span>
                    ) : (
                      <span className="sc-miss">No file received</span>
                    )}
                  </td>
                  <td>{r.completed ? <span className="sc-ok">✓ Yes</span> : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Challenge-wise averages across the selected attempts (Host view).
export function ChallengeAverages({
  rows,
}: {
  rows: {
    task: string;
    label: string;
    attempts: number;
    mcqMarks: number | null;
    practical: number | null;
    total: number | null;
    evaluated: number;
    evidence: number;
  }[];
}) {
  return (
    <section className="panel sc-table-panel" aria-labelledby="ca-title">
      <h2 id="ca-title">Challenge-wise performance</h2>
      <p className="help">Submitted attempts; averages use evaluated challenges only.</p>
      <div className="sc-table-wrap">
        <table className="sc-table">
          <thead>
            <tr>
              <th>Challenge</th>
              <th>Attempts</th>
              <th>Avg MCQ /12</th>
              <th>Avg practical /8</th>
              <th>Avg total /20</th>
              <th>Evidence received</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.task}>
                <td>{r.label}</td>
                <td>{r.attempts}</td>
                <td>{r.mcqMarks ?? "—"}</td>
                <td>{r.practical ?? "—"}</td>
                <td>
                  {r.total === null ? "—" : <b>{r.total}</b>}
                  {r.attempts > 0 && r.evaluated < r.attempts && (
                    <small> · {r.attempts - r.evaluated} pending</small>
                  )}
                </td>
                <td>
                  {r.attempts ? `${r.evidence} of ${r.attempts}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
