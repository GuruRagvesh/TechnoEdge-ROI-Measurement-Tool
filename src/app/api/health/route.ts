import { validateConfig } from "@/lib/config";
import { HybridStorage, storage } from "@/lib/storage";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    validateConfig();
    // With RECORD_STORE=postgres, also confirm the database answers. Only
    // "ok" or "unavailable" is reported, never a connection detail.
    let database: "ok" | "unavailable" | undefined;
    const s = storage();
    if (s instanceof HybridStorage)
      database = await s.records.ping().then(
        () => "ok" as const,
        () => "unavailable" as const,
      );
    return Response.json(
      {
        status: database === "unavailable" ? "degraded" : "ok",
        checks: database ? "configuration-and-database" : "runtime-configuration-only",
        recordStore: database ? "postgres" : "sharepoint",
        ...(database ? { database } : {}),
        liveIntegrationsVerified: false,
      },
      {
        status: database === "unavailable" ? 503 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "health_failed",
        name: e instanceof Error ? e.name : "unknown",
        code: (e as { code?: string })?.code,
        at: new Date().toISOString(),
      }),
    );
    // Name the failing setting so operators can fix it. Only fixed messages
    // from validateConfig pass; a setting's value is never included.
    const message = e instanceof Error ? e.message : "";
    const reason =
      /^(Missing server configuration: [A-Z0-9_]+|Production requires [A-Za-z ]+|Select the approved production email provider|Explicitly disable local credentials and mock email in production|An (approved dedicated SharePoint site URL|explicit application storage root) is required|Real Graph storage requires cohorts-v1; migrate existing data explicitly|EVIDENCE_MAX_MIB must be an integer from 1 to 250)$/.test(
        message,
      )
        ? message
        : "Invalid server configuration";
    return Response.json(
      { status: "not-ready", reason },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
