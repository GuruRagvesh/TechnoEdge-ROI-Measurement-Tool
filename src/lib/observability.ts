import { randomUUID } from "node:crypto";
import type { GraphMetrics } from "./request-metrics";
// Application error codes such as STORAGE_THROTTLED (never messages or data).
function errorCode(fault: unknown) {
  const code = (fault as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && /^[A-Z_]{3,40}$/.test(code)
    ? code
    : undefined;
}
export function requestEvent(
  route: string,
  status: number,
  durationMs: number,
  fault?: unknown,
  graph?: GraphMetrics,
) {
  const event = {
    event: "http_request",
    requestId: randomUUID(),
    route: route.replace(/[^a-zA-Z0-9_./[\]-]/g, "_").slice(0, 200),
    status,
    durationMs,
    at: new Date().toISOString(),
    ...(graph && graph.calls ? { graph } : {}),
    ...(errorCode(fault) ? { errorCode: errorCode(fault) } : {}),
    ...(fault instanceof Error
      ? {
          errorType: fault.name.replace(/[^A-Za-z]/g, "").slice(0, 40),
          ...([
            "EPERM",
            "EACCES",
            "EBUSY",
            "ENOENT",
            "ELOCKED",
            "ETIMEDOUT",
            "ECONNRESET",
          ].includes((fault as NodeJS.ErrnoException).code || "")
            ? { systemCode: (fault as NodeJS.ErrnoException).code }
            : {}),
        }
      : {}),
  };
  console.log(JSON.stringify(event));
  return event;
}
export async function reportError(
  event: ReturnType<typeof requestEvent>,
  fetcher: typeof fetch = fetch,
) {
  const endpoint = process.env.ERROR_MONITOR_URL;
  if (!endpoint) return;
  try {
    if (new URL(endpoint).protocol !== "https:")
      throw new Error("HTTPS required");
    const r = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ERROR_MONITOR_TOKEN
          ? { Authorization: "Bearer " + process.env.ERROR_MONITOR_TOKEN }
          : {}),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) throw new Error("Collector unavailable");
  } catch {
    console.error(
      JSON.stringify({
        event: "error_collector_unavailable",
        requestId: event.requestId,
      }),
    );
  }
}
