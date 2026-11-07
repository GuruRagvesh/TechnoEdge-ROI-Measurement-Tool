"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Timer,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import { api, ErrorBox } from "@/components/ui";
import type { Identity } from "@/lib/types";
type Stage = "identifier" | "password" | "details" | "code";
export default function Home() {
  const [stage, setStage] = useState<Stage>("identifier"),
    [identifier, setIdentifier] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [localAvailable, setLocalAvailable] = useState(false),
    [checkingSession, setCheckingSession] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const saved = sessionStorage.getItem("te-login");
    if (saved) {
      try {
        const x = JSON.parse(saved);
        setIdentifier(x.email);
        setName(x.name);
        setChallenge(x.challenge);
        setStage("code");
      } catch {
        sessionStorage.removeItem("te-login");
      }
    }
    api<{ identity: Identity | null; localAccountsAvailable: boolean }>(
      "auth/me",
    )
      .then((x) => {
        setLocalAvailable(x.localAccountsAvailable);
        if (x.identity) location.replace("/" + x.identity.role);
      })
      .catch((e) => setError(e.message))
      .finally(() => setCheckingSession(false));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const value = identifier.trim();
      if (stage === "identifier") {
        if (
          localAvailable &&
          ["DEMO001", "HOST001"].includes(value.toUpperCase())
        ) {
          setIdentifier(value.toUpperCase());
          setStage("password");
        } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          setIdentifier(value.toLowerCase());
          setStage("details");
        } else throw new Error("Enter a valid email address.");
      } else if (stage === "password") {
        const result = await api<{ destination: string }>("auth/test-login", {
          userId: identifier,
          password,
        });
        setPassword("");
        location.assign(result.destination);
      } else if (stage === "details") {
        const result = await api<{ challengeId: string }>("auth/request-code", {
          name,
          email: identifier,
        });
        sessionStorage.setItem(
          "te-login",
          JSON.stringify({
            email: identifier,
            name,
            challenge: result.challengeId,
          }),
        );
        history.replaceState(null, "", "/verify");
        setChallenge(result.challengeId);
        setStage("code");
      } else {
        const identity = await api<Identity>("auth/verify-code", {
          challengeId: challenge,
          code,
        });
        sessionStorage.removeItem("te-login");
        location.assign("/" + identity.role);
      }
    } catch (e) {
      setError((e as Error).message);
      if (stage === "password") setPassword("");
    } finally {
      setBusy(false);
    }
  }
  function back() {
    sessionStorage.removeItem("te-login");
    history.replaceState(null, "", "/login");
    setStage("identifier");
    setPassword("");
    setCode("");
    setError("");
  }
  return (
    <div className="welcome">
      <header className="welcome-header">
        <div className="brand">
          <span className="brand-mark">T</span>
          <span>
            TechnoEdge Assessment ROI
            <small>Assessment ROI · Learning Services</small>
          </span>
        </div>
        <span className="verified">
          <ShieldCheck size={16} /> Secure corporate assessments
        </span>
      </header>
      <main className="welcome-main">
        <section className="welcome-story">
          <div className="eyebrow">TECHNOEDGE / PRODUCTIVITY BENCHMARK</div>
          <h1>
            Real-world skills.
            <br />
            <em>Real progress.</em>
          </h1>
          <p>
            A practical benchmark for the way you work. Take on real business
            challenges, discover your strengths, and see what changes with AI.
          </p>
          <div className="welcome-features">
            <span>
              <Timer />
              60 minutes
            </span>
            <span>
              <Layers />
              Choose 3 of 5
            </span>
            <span>
              <Sparkles />
              Pre & Post AI
            </span>
          </div>
          <div className="story-card">
            <div className="mini-chart">
              <i style={{ height: "35%" }} />
              <i style={{ height: "55%" }} />
              <i style={{ height: "45%" }} />
              <i style={{ height: "72%" }} />
              <i style={{ height: "88%" }} />
            </div>
            <div>
              <span className="eyebrow">EVIDENCE OVER ESTIMATES</span>
              <strong>
                See your progress.
                <br />
                Understand your impact.
              </strong>
              <small>Skills · Quality · Time · Productivity</small>
            </div>
            <ArrowUpRight size={22} />
          </div>
        </section>
        <section className="signin-card">
          <span className="pill">WELCOME TO YOUR WORKSPACE</span>
          <h1>Welcome to TechnoEdge</h1>
          <p>Sign in to continue.</p>
          <form onSubmit={submit}>
            {stage === "identifier" ? (
              <>
                <label htmlFor="identifier">Email or User ID</label>
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={identifier}
                  maxLength={254}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                />
              </>
            ) : (
              <>
                <label htmlFor="account">Account</label>
                <input
                  id="account"
                  value={identifier}
                  readOnly
                  autoComplete="username"
                />
              </>
            )}
            {stage === "password" && (
              <>
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  maxLength={256}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
              </>
            )}
            {stage === "details" && (
              <>
                <label htmlFor="name">Full name</label>
                <input
                  id="name"
                  autoComplete="name"
                  placeholder="Your full name"
                  value={name}
                  minLength={2}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
                <p className="help">
                  We’ll email a verification code. Use the same email for both
                  assessments.
                </p>
              </>
            )}
            {stage === "code" && (
              <>
                <label htmlFor="code">Verification code</label>
                <input
                  id="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoFocus
                />
                <p className="help">
                  Enter the 6-digit code sent to {identifier}. Valid for 10
                  minutes.
                </p>
              </>
            )}
            <button
              className="button primary full"
              disabled={busy || checkingSession}
            >
              {busy || checkingSession
                ? "Please wait…"
                : stage === "identifier"
                  ? "Continue"
                  : stage === "password"
                    ? "Sign in"
                    : stage === "details"
                      ? "Send verification code"
                      : "Verify & continue"}
              <ArrowRight size={18} />
            </button>
            {stage === "code" && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const x = await api<{ challengeId: string }>(
                      "auth/request-code",
                      { name, email: identifier },
                    );
                    setChallenge(x.challengeId);
                    setCode("");
                    sessionStorage.setItem(
                      "te-login",
                      JSON.stringify({
                        email: identifier,
                        name,
                        challenge: x.challengeId,
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Resend verification code
              </button>
            )}
            {stage !== "identifier" && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={back}
              >
                Use a different account
              </button>
            )}
          </form>
          <ErrorBox message={error} />
          <div className="signin-note">
            <CheckCircle2 size={16} /> Verified identity. Saved progress. Secure
            evidence.
          </div>
        </section>
      </main>
      <footer>
        TechnoEdge Learning Services{" "}
        <span>Learning that moves you forward.</span>
      </footer>
    </div>
  );
}
