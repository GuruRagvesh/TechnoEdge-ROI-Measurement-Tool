"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  api,
  Empty,
  ErrorBox,
  format,
  Loading,
  Shell,
  Stat,
  useIdentity,
} from "@/components/ui";
import type { Participant, Room } from "@/lib/types";
import type { comparison, metrics } from "@/lib/assessment";
import { PrePostCharts } from "@/components/pre-post-charts";
type Entry = {
  room: Room;
  participant: Participant | null;
  metrics: ReturnType<typeof metrics> | null;
  comparison: ReturnType<typeof comparison> | null;
};
export default function Attendee() {
  const path = usePathname();
  const program = path.includes("/results/") ? path.split("/")[3] : null;
  const { identity, error: authError } = useIdentity("attendee"),
    [entries, setEntries] = useState<Entry[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    const load = () =>
      api<{ entries: Entry[] }>("dashboard")
        .then((x) => {
          if (!cancelled) {
            setEntries(x.entries);
            setLoaded(true);
            setError("");
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [identity]);
  if (!identity)
    return authError ? <ErrorBox message={authError} /> : <Loading />;
  if (!loaded)
    return (
      <Shell identity={identity}>
        {error ? (
          <>
            <ErrorBox message={error} />
            <button
              className="button secondary"
              onClick={() => location.reload()}
            >
              Retry loading assessments
            </button>
          </>
        ) : (
          <Loading />
        )}
      </Shell>
    );
  const activeAttempt = entries.find(
    (x) =>
      x.participant?.startedAt && !x.participant.submittedAt && !x.room.closed,
  );
  const completed = entries
      .filter((x) => x.participant?.submittedAt)
      .sort(
        (a, b) =>
          Date.parse(a.participant!.submittedAt!) -
          Date.parse(b.participant!.submittedAt!),
      ),
    paired = entries.find(
      (x) =>
        x.comparison?.comparable &&
        (!program || x.room.programId === program || x.room.id === program),
    ),
    latest = completed.at(-1);
  return (
    <Shell identity={identity}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PERSONAL BENCHMARK</div>
          <h1>
            {path.includes("/results")
              ? "Your results"
              : path.includes("/assessments")
                ? "My Assessments"
                : `Welcome back, ${identity.name.split(" ")[0]}`}
            <span className="wave">.</span>
          </h1>
          <p>Your assessments, progress and evaluated results in one place.</p>
        </div>
        <span className="pill verified">
          <CheckCircle2 size={14} /> Email verified
        </span>
      </div>
      {path === "/attendee" && (
        <section className="hero-banner">
          <div>
            <span className="pill light">BASE CAMP → SUMMIT</span>
            <h2>Your assessment journey.</h2>
            <p>
              Three practical challenges. One hour. Real evidence of how you
              work.
            </p>
            {activeAttempt && (
              <Link
                className="button white"
                href={"/attendee/rooms/" + activeAttempt.room.id}
              >
                Resume Assessment
              </Link>
            )}
            <div className="hero-facts">
              <span>
                <Clock3 size={16} /> Server-timed assessment
              </span>
              <span>
                <Target size={16} /> Results that matter
              </span>
            </div>
          </div>
          <div className="hero-orbit">
            <span>
              3
              <span>
                OF 5<br />
                CHALLENGES
              </span>
            </span>
            <i />
            <b>↗</b>
          </div>
        </section>
      )}
      <section className="stats-grid">
        <Stat
          label="Assessments submitted"
          value={completed.length}
          detail="Across your joined rooms"
        />
        <Stat
          label="Latest final score"
          value={format(
            latest?.metrics?.score,
            ` / ${latest?.metrics?.maximum || 60}`,
          )}
          detail={
            latest?.metrics?.fullyGraded
              ? "MCQ + practical evaluation"
              : "Available after practical evaluation"
          }
        />
        <Stat
          label="Latest MCQ accuracy"
          value={format(latest?.metrics?.accuracy, "%")}
          detail="Automatically marked results"
        />
        <Stat
          label="Observed time reduction"
          value={format(paired?.comparison?.timeReduction, "%")}
          detail="Matched & graded Pre/Post pair"
          icon={<TrendingUp size={17} />}
        />
      </section>
      <div className="section-heading">
        <div>
          <h2>Your assessments</h2>
          <p>Pick up where you left off, or start a new benchmark.</p>
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="room-grid">
        {entries
          .filter((x) =>
            path.includes("/results")
              ? !!x.participant?.submittedAt &&
                (!program ||
                  x.room.programId === program ||
                  x.room.id === program)
              : true,
          )
          .map(({ room, participant: p, metrics: m }) => (
            <article className="room-card" key={room.id}>
              <div className="card-top">
                <span
                  className={
                    "pill " + (room.phase === "post" ? "mint" : "lavender")
                  }
                >
                  {room.phase === "pre" ? "PRE-AI" : "POST-AI"} BENCHMARK
                </span>
                <span className="subtle">{room.durationMinutes} min</span>
              </div>
              <h3>{room.company || room.name}</h3>
              <p>
                <strong>{room.phase === "pre" ? "Base Camp" : "Summit"}</strong>{" "}
                · {room.closed ? "Closed" : "Open"}
              </p>
              <p>
                {room.batch} ·{" "}
                {room.phase === "pre"
                  ? "Establish your baseline"
                  : "Measure what changed"}
              </p>
              <div className="task-progress">
                <span>
                  {p?.submittedAt
                    ? p.submissionReason === "deadline"
                      ? "Expired"
                      : m?.fullyGraded
                        ? "Finalized"
                        : "Awaiting evaluation"
                    : p?.startedAt
                      ? "In progress"
                      : p
                        ? "Ready to start"
                        : "Not started"}
                </span>
                <strong>{m?.completed || 0} / 3 tasks</strong>
              </div>
              <div className="progress-track">
                <i style={{ width: `${((m?.completed || 0) / 3) * 100}%` }} />
              </div>
              <div className="card-bottom">
                <span>
                  {p?.submittedAt
                    ? m?.fullyGraded
                      ? `Score ${m.score}/${m.maximum}`
                      : "Practical evaluation pending"
                    : room.closed
                      ? "Room closed"
                      : "Your progress is saved as you work"}
                </span>
                {p ? (
                  <Link
                    className="button primary compact"
                    href={`/attendee/rooms/${room.id}`}
                  >
                    {p.submittedAt
                      ? "View results"
                      : p.startedAt
                        ? "Resume Assessment"
                        : "Open assessment"}
                    <ArrowRight size={15} />
                  </Link>
                ) : (
                  <Link
                    className="button primary compact"
                    href={"/attendee/join?code=" + room.id}
                  >
                    {room.closed ? "Room closed" : "Join room"}
                    <ArrowRight size={15} />
                  </Link>
                )}
              </div>
              {room.phase === "post" &&
                entries.find((x) => x.room.id === room.id)?.comparison
                  ?.comparable && (
                  <Link
                    className="button secondary compact"
                    href={`/attendee/results/${room.programId || room.id}/comparison`}
                  >
                    View Pre/Post comparison
                  </Link>
                )}
            </article>
          ))}
      </div>
      {paired && (
        <section className="panel comparison-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">YOUR BEFORE & AFTER</span>
              <h2>Progress you can see.</h2>
            </div>
          </div>
          {paired.metrics &&
            entries.find((x) => x.room.id === paired.room.preRoomId)
              ?.metrics && (
              <PrePostCharts
                pre={
                  entries.find((x) => x.room.id === paired.room.preRoomId)!
                    .metrics!
                }
                post={paired.metrics}
              />
            )}
          <div className="stats-grid">
            <Stat
              label="Elapsed minutes saved"
              value={format(paired.comparison?.minutesSaved)}
              detail="Pre minus Post elapsed time"
            />
            <Stat
              label="Score improvement"
              value={format(paired.comparison?.scoreDelta, " marks")}
              detail={`On the ${paired.metrics?.maximum}-mark scoring model`}
            />
            <Stat
              label="Accuracy improvement"
              value={format(paired.comparison?.accuracyDelta, " pp")}
              detail="Percentage-point change"
            />
            <Stat
              label="Quality improvement"
              value={format(paired.comparison?.qualityDelta, " pp")}
              detail="Percentage-point change"
            />
          </div>
          <p className="help">
            Observed differences across equivalent tasks. Familiarity, task
            order and other factors may affect results; this is not a causal
            estimate of AI impact.
          </p>
        </section>
      )}
      <div className="info-strip">
        <Target size={22} />
        <div>
          <strong>Good work is more than fast work.</strong>
          <p>
            Your benchmark considers accuracy, practical quality and
            completeness alongside elapsed time.
          </p>
        </div>
      </div>
    </Shell>
  );
}
