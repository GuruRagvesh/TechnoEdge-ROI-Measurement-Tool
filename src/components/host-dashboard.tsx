"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock3, FileSpreadsheet, RefreshCw } from "lucide-react";
import { DownloadLink, Empty, ErrorBox } from "@/components/ui";
import {
  cardsFor,
  summary,
  type AssessmentStatus,
  type RoomRecords,
} from "@/lib/scorecard";
import {
  ChallengeAverages,
  ChallengeResults,
  Definitions,
  fmt,
  NA,
  PrePostPanel,
  PrimaryMetrics,
  SecondaryMetrics,
  StatusPill,
} from "@/components/scorecard-view";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function HostDashboard({
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
    [status, setStatus] = useState<"all" | AssessmentStatus>("all"),
    [person, setPerson] = useState("all");
  const all = useMemo(() => cardsFor(data), [data]);
  const inRoom = all.filter((c) => roomId === "all" || c.roomId === roomId);
  const filtered = inRoom.filter((c) => status === "all" || c.status === status);
  const selected =
    person === "all"
      ? null
      : (filtered.find((c) => c.roomId + "/" + c.participantId === person) ??
        null);
  const s = useMemo(() => summary(filtered), [filtered]);
  const stale = !!updated && !!error;
  if (!loaded && !error)
    return <div className="sc-skeleton" aria-busy="true" aria-label="Loading dashboard" />;
  return (
    <div className="sc-root">
      <div className="sc-filters" role="group" aria-label="Dashboard filters">
        <label>
          Room
          <select
            value={roomId}
            onChange={(e) => {
              setRoomId(e.target.value);
              setPerson("all");
            }}
          >
            <option value="all">All rooms ({data.length})</option>
            {data.map((d) => (
              <option key={d.room.id} value={d.room.id}>
                {[d.room.company || d.room.name, d.room.batch]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPerson("all");
            }}
          >
            <option value="all">All statuses</option>
            <option>Not started</option>
            <option>In progress</option>
            <option>Submitted</option>
            <option>Evaluated</option>
          </select>
        </label>
        <label>
          Participant
          <select value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="all">All participants ({filtered.length})</option>
            {filtered.map((c) => (
              <option
                key={c.roomId + "/" + c.participantId}
                value={c.roomId + "/" + c.participantId}
              >
                {c.name}
                {roomId === "all" ? " · " + c.roomLabel : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="sc-actions">
          <span className={"sc-updated" + (stale ? " stale" : "")}>
            {stale ? <AlertTriangle size={13} /> : <Clock3 size={13} />}
            {updated
              ? `${stale ? "Last updated" : "Updated"} ${new Date(updated).toLocaleTimeString("en-IN")}`
              : "Not loaded"}
          </span>
          <button className="button secondary compact" onClick={onRefresh}>
            <RefreshCw size={14} /> Refresh
          </button>
          {roomId === "all" ? (
            <Link className="button secondary compact" href="/host/reports/export">
              <FileSpreadsheet size={14} /> Excel export
            </Link>
          ) : (
            <DownloadLink href={`/api/rooms/${roomId}/export`}>
              <FileSpreadsheet size={14} /> Download Excel
            </DownloadLink>
          )}
        </div>
      </div>
      {error && (
        <ErrorBox
          message={`Could not refresh: ${error}. Showing the last loaded data.`}
        />
      )}
      {data.length === 0 ? (
        <Empty
          title="No rooms yet"
          detail="Create a room and share its code. Results appear here as participants work."
        />
      ) : filtered.length === 0 ? (
        <Empty
          title="No participants match these filters"
          detail="Change the room or status filter to see results."
        />
      ) : selected ? (
        <>
          <div className="sc-person">
            <div>
              <span className="eyebrow">PARTICIPANT</span>
              <h2>{selected.name}</h2>
              <p>
                {selected.roomLabel}
                {selected.submittedAt &&
                  " · submitted " + when(selected.submittedAt)}
                {selected.endedAtDeadline && " · ended at the deadline"}
              </p>
            </div>
            <div className="sc-person-actions">
              <StatusPill status={selected.status} />
              {selected.submittedAt && (
                <Link
                  className="button primary compact"
                  href={`/host/rooms/${selected.roomId}/evaluate/${selected.participantId}`}
                >
                  {selected.evaluation === "Finalized" ? "View evaluation" : "Evaluate"}
                </Link>
              )}
              <button className="button secondary compact" onClick={() => setPerson("all")}>
                All participants
              </button>
            </div>
          </div>
          <PrimaryMetrics
            score={selected.score}
            maximum={selected.maximum}
            scoreDetail={
              selected.score !== null
                ? "Finalized assessment"
                : selected.submittedAt
                  ? "Practical evaluation pending"
                  : "Assessment not submitted"
            }
            attempted={selected.attempted || null}
            attemptedDetail={`${selected.mcqAnswered} of ${selected.attempted * 4} MCQs answered`}
            minutes={selected.minutes}
            minutesDetail={
              selected.minutes !== null
                ? `Out of ${60} minutes`
                : "Shown after submission"
            }
            accuracy={selected.accuracy}
            accuracyDetail={
              selected.accuracy !== null
                ? `${selected.mcqCorrect} of ${selected.mcqAnswered} correct`
                : "Shown after submission"
            }
          />
          <PrePostPanel
            pre={selected.pre}
            post={selected.post}
            improvement={selected.improvement}
            maximum={selected.maximum}
            detail="This participant's matched, evaluated assessments."
          />
          <SecondaryMetrics
            items={[
              { label: "Assessment status", value: <StatusPill status={selected.status} /> },
              { label: "Evaluation status", value: <StatusPill status={selected.evaluation} /> },
              {
                label: "Evidence uploaded",
                value: `${selected.evidenceReceived} of ${selected.evidenceExpected || 3}`,
                detail: "Files verified by the server",
              },
              {
                label: "Completion",
                value: fmt(selected.completion, "%"),
                detail: "Selected challenges marked complete",
              },
            ]}
          />
          <ChallengeResults
            rows={selected.challenges}
            submitted={!!selected.submittedAt}
          />
        </>
      ) : (
        <>
          <PrimaryMetrics
            score={s.score}
            maximum={60}
            scoreDetail={
              s.finalized
                ? `Average of ${s.finalized} finalized assessment${s.finalized === 1 ? "" : "s"}`
                : "No finalized assessments yet"
            }
            attempted={s.attempted}
            attemptedDetail={`Average per started attempt (${s.started})`}
            minutes={s.minutes}
            minutesDetail={
              s.submitted
                ? `Average of ${s.submitted} submitted · limit 60 min`
                : "Shown after submission"
            }
            accuracy={s.accuracy}
            accuracyDetail={
              s.mcqAnswered
                ? `${s.mcqCorrect} of ${s.mcqAnswered} answered MCQs correct`
                : "Shown after submission"
            }
          />
          <PrePostPanel
            pre={s.pre}
            post={s.post}
            improvement={s.improvement}
            detail={
              s.pairs
                ? `Averages of ${s.pairs} matched participant${s.pairs === 1 ? "" : "s"}.`
                : "No matched Pre-Test and Post-Test records in this selection."
            }
          />
          <SecondaryMetrics
            items={[
              {
                label: "Assessment status",
                value: `${s.submitted} of ${s.attempts} submitted`,
                detail: s.status
                  .filter((x) => x.count)
                  .map((x) => `${x.count} ${x.label.toLowerCase()}`)
                  .join(" · "),
              },
              {
                label: "Evaluation status",
                value: `${s.finalized} finalized`,
                detail: s.pending ? `${s.pending} pending evaluation` : "None pending",
              },
              {
                label: "Evidence uploaded",
                value: `${s.evidenceReceived} of ${s.evidenceExpected}`,
                detail: "Verified files for selected challenges",
              },
              {
                label: "Completion",
                value: fmt(s.completion, "%"),
                detail: "Average across started attempts",
              },
            ]}
          />
          <ChallengeAverages rows={s.challenges} />
          <section className="panel sc-table-panel" aria-labelledby="pt-title">
            <h2 id="pt-title">Participants</h2>
            <p className="help">Select a name for that participant&apos;s full results.</p>
            <div className="sc-table-wrap">
              <table className="sc-table sc-people">
                <thead>
                  <tr>
                    <th>Participant</th>
                    {roomId === "all" && <th>Room</th>}
                    <th>Status</th>
                    <th>Score /60</th>
                    <th>MCQ accuracy</th>
                    <th>Time</th>
                    <th>Evidence</th>
                    <th>Completion</th>
                    <th>Evaluation</th>
                    <th>Pre → Post</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.roomId + "/" + c.participantId}>
                      <td>
                        <button
                          className="sc-link"
                          onClick={() => setPerson(c.roomId + "/" + c.participantId)}
                        >
                          {c.name}
                        </button>
                      </td>
                      {roomId === "all" && <td>{c.roomLabel}</td>}
                      <td>
                        <StatusPill status={c.status} />
                      </td>
                      <td>{c.score === null ? (c.submittedAt ? "Pending" : "—") : <b>{c.score}</b>}</td>
                      <td>{c.accuracy === null ? "—" : `${fmt(c.accuracy)}%`}</td>
                      <td>{c.minutes === null ? "—" : c.minutes < 1 ? "< 1 min" : `${fmt(c.minutes)} min`}</td>
                      <td>{`${c.evidenceReceived}/${c.evidenceExpected || 3}`}</td>
                      <td>{fmt(c.completion, "%")}</td>
                      <td>{c.evaluation === "Not submitted" ? "—" : <StatusPill status={c.evaluation} />}</td>
                      <td className="sc-muted">
                        {c.pre === null ? NA : `${c.pre} → ${c.post} (${c.improvement! > 0 ? "+" : ""}${c.improvement})`}
                      </td>
                      <td>
                        {c.evaluation === "Pending" && (
                          <Link
                            className="button primary compact"
                            href={`/host/rooms/${c.roomId}/evaluate/${c.participantId}`}
                          >
                            Evaluate
                          </Link>
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
      <Definitions />
    </div>
  );
}
