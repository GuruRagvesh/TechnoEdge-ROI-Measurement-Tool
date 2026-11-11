"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Identity } from "@/lib/types";
export async function api<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}
// Set from the server before any signed-in page renders its Shell.
let singleRound = true;
export function useIdentity(role: "host" | "attendee") {
  const [identity, set] = useState<Identity | null>(null),
    [single, setSingle] = useState(true),
    [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    api<{ identity: Identity | null; assessmentMode?: string }>("auth/me")
      .then((x) => {
        if (!x.identity || x.identity.role !== role)
          router.replace(x.identity ? "/" + x.identity.role : "/login");
        else {
          singleRound = x.assessmentMode !== "paired";
          setSingle(singleRound);
          set(x.identity);
        }
      })
      .catch((e) => setError(e.message));
  }, [role, router]);
  return { identity, error, single };
}
export function Shell({
  identity,
  children,
}: {
  identity: Identity;
  children: React.ReactNode;
}) {
  const [error, setError] = useState("");
  const path = usePathname();
  const host = identity.role === "host";
  const links = host
    ? [
        ["/host", "Dashboard"],
        ["/host/assessments", singleRound ? "Rooms" : "Assessments"],
        singleRound
          ? ["/host/reports/export", "Results export"]
          : ["/host/reports", "Results & Reports"],
      ]
    : singleRound
      ? [
          ["/attendee", "Dashboard"],
          ["/attendee/results", "My results"],
        ]
      : [
          ["/attendee", "Dashboard"],
          ["/attendee/assessments", "My Assessments"],
          ["/attendee/results", "Results"],
        ];
  const activeAttempt = path.includes("/rooms/") || path.includes("/attempt/");
  return (
    <div className="corporate-shell">
      <aside className="corporate-sidebar">
        <Link className="brand" href={host ? "/host" : "/attendee"}>
          <span className="brand-mark">T</span>
          <span>
            TechnoEdge<small>ASSESSMENT ROI</small>
          </span>
        </Link>
        <div className="eyebrow">{host ? "HOST" : "YOUR"} WORKSPACE</div>
        <nav aria-label="Primary navigation">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={
                href === path || (href !== links[0][0] && path.startsWith(href))
                  ? "page"
                  : undefined
              }
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <small>TechnoEdge Learning Services</small>
          <button
            className="button secondary compact"
            onClick={async () => {
              try {
                await api("auth/logout", {});
                location.href = "/login";
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="corporate-body">
        <header className="corporate-topbar">
          <div>
            <small>{host ? "Host" : "Attendee"} portal</small>
            <strong>
              {host
                ? "Assessment Management"
                : singleRound
                  ? "AI Productivity Assessment"
                  : "AI Productivity Benchmark"}
            </strong>
          </div>
          <div className="button-row">
            {!host && !activeAttempt && path !== "/attendee/join" && (
              <Link className="button primary" href="/attendee/join">
                {singleRound ? "Start Assessment" : "+ Start Test"}
              </Link>
            )}
            <span className="user-name">{identity.name}</span>
          </div>
        </header>
        <main className="corporate-content">
          <ErrorBox message={error} />
          {children}
        </main>
        <footer>
          © {new Date().getFullYear()} TechnoEdge Learning Services
        </footer>
      </div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="brand-mark">T</span> Loading your workspace…
    </div>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {label}
        {icon || <ChartNoAxesCombined size={17} />}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <ChartNoAxesCombined />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
export { format } from "@/lib/format";
export function DownloadLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [parts, setParts] = useState<{ label: string; href: string }[]>([]);
  return (
    <>
      <button
        className="button secondary compact"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await fetch(href);
            if (!r.ok) {
              const data = await r.json();
              throw new Error(data.error || "Download failed");
            }
            if (r.headers.get("content-type")?.includes("application/json")) {
              const result = await r.json();
              if (result.parts) {
                if (
                  !Array.isArray(result.parts) ||
                  result.parts.some(
                    (p: { href: string }) =>
                      typeof p.href !== "string" ||
                      !p.href.startsWith("/api/rooms/") ||
                      !p.href.includes("/evidence-zip?plan="),
                  )
                )
                  throw new Error("Invalid archive plan");
                setParts(result.parts);
                return;
              }
              const u = new URL(result.downloadUrl);
              if (
                u.protocol !== "https:" ||
                ![".sharepoint.com", ".1drv.com", ".onedrive.com"].some((h) =>
                  u.hostname.endsWith(h),
                )
              )
                throw new Error("Invalid download address");
              // Save under the participant's original filename; the stored
              // SharePoint name differs. Fall back to opening the link.
              try {
                const file = await fetch(u.href, {
                  credentials: "omit",
                  referrerPolicy: "no-referrer",
                });
                if (!file.ok) throw new Error("download");
                const objectUrl = URL.createObjectURL(await file.blob()),
                  a = document.createElement("a");
                a.href = objectUrl;
                a.download = result.name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
              } catch {
                const link = document.createElement("a");
                link.href = u.href;
                link.download = result.name;
                link.rel = "noreferrer";
                link.click();
              }
              return;
            }
            const url = URL.createObjectURL(await r.blob()),
              a = document.createElement("a");
            a.href = url;
            a.download =
              r.headers
                .get("content-disposition")
                ?.match(/filename="([^"]+)"/)?.[1] || "download";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparing…" : children}
        <ArrowUpRight size={14} />
      </button>
      {parts.length > 0 && (
        <div className="button-row" aria-label="Evidence archive parts">
          {parts.map((p) => (
            <DownloadLink key={p.href} href={p.href}>
              {p.label}
            </DownloadLink>
          ))}
        </div>
      )}
      <ErrorBox message={error} />
    </>
  );
}
