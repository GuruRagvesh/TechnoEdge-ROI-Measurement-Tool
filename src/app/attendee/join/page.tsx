"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ErrorBox, Loading, Shell, useIdentity } from "@/components/ui";
import type { Room } from "@/lib/types";
export default function Join() {
  const { identity, error: authError } = useIdentity("attendee");
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCode(new URLSearchParams(location.search).get("code") || "");
  }, []);
  async function validate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setRoom(null);
    setKind("");
    try {
      const response = await fetch(
        "/api/rooms/" + encodeURIComponent(code.trim()) + "/validate",
        { cache: "no-store" },
      );
      const x = await response.json();
      if (!response.ok) {
        setKind(x.code);
        throw new Error(x.error);
      }
      setRoom(x.room);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await api("rooms/" + room!.id + "/join", {});
      location.assign("/attendee/rooms/" + room!.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setRoom(null);
    }
  }
  if (!identity)
    return authError ? <ErrorBox message={authError} /> : <Loading />;
  return (
    <Shell identity={identity}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">START AN ASSESSMENT</span>
          <h1>Join an assessment</h1>
          <p>Validate your room code before starting the clock.</p>
        </div>
      </div>
      <section className="panel narrow-panel">
        <form onSubmit={validate}>
          <label htmlFor="room-code">Room code</label>
          <input
            id="room-code"
            autoComplete="off"
            value={code}
            maxLength={100}
            pattern="[A-Za-z0-9_-]+"
            required
            onChange={(e) => {
              setCode(e.target.value);
              setRoom(null);
              setError("");
              setKind("");
            }}
          />
          <button className="button primary" disabled={busy}>
            Validate room
          </button>
        </form>
        <ErrorBox message={error} />
        {(kind === "ATTEMPT_EXPIRED" || kind === "ATTEMPT_SUBMITTED") && (
          <Link
            className="button secondary"
            href={"/attendee/rooms/" + encodeURIComponent(code.trim())}
          >
            View attempt and results
          </Link>
        )}
        {room && (
          <div className="join-confirm">
            <h2>{room.company || room.name}</h2>
            <p>
              {room.batch} ·{" "}
              {room.phase === "pre"
                ? "Base Camp — Before AI"
                : "Summit — After AI"}
            </p>
            <ul>
              <li>
                {room.durationMinutes} minutes. The server clock starts on
                confirmation and continues across reloads and disconnections.
              </li>
              <li>
                {room.phase === "pre"
                  ? "Choose exactly three of five practical challenges. Selection time is included."
                  : "Your three Base Camp categories are reused with different datasets."}
              </li>
              <li>
                {room.phase === "pre"
                  ? "Do not use generative AI for this baseline."
                  : "AI tools are permitted. Document your method."}
              </li>
              <li>
                Submission or expiry locks the attempt. You can resume an
                existing active attempt with its original deadline.
              </li>
              <li>
                {room.scoringVersion === "corporate-60-v1"
                  ? "60 marks: 12 MCQ + 8 practical marks per task."
                  : "Historical scoring model: 100 points."}
              </li>
            </ul>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void confirm()}
            >
              Enter room and start timer
            </button>
          </div>
        )}
      </section>
    </Shell>
  );
}
