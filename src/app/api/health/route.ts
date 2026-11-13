import { validateConfig } from "@/lib/config";
import { HybridStorage, storage } from "@/lib/storage";
import { PostgresRecords } from "@/lib/record-store";
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
    // Configured but not yet active: check the database can be reached before
    // any traffic is switched to it.
    let databasePreflight: "ok" | "unavailable" | undefined;
    let databasePreflightCode: string | undefined;
    if (!database && process.env.RECORD_STORE === "postgres") {
      const probe = new PostgresRecords();
      databasePreflight = await probe.ping().then(
        () => "ok" as const,
        (e) => {
          // An error code only (for example a TLS or authentication code),
          // never a host, user or message.
          const code = (e as { cause?: { code?: string } })?.cause?.code;
          databasePreflightCode =
            typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)
              ? code
              : "UNKNOWN";
          console.error(
            JSON.stringify({
              event: "database_preflight_failed",
              cause: (e as { cause?: { code?: string } })?.cause?.code,
              at: new Date().toISOString(),
            }),
          );
          return "unavailable" as const;
        },
      );
      await probe.end().catch(() => {});
    }
    return Response.json(
      {
        status: database === "unavailable" ? "degraded" : "ok",
        checks: database ? "configuration-and-database" : "runtime-configuration-only",
        recordStore: database ? "postgres" : "sharepoint",
        ...(database ? { database } : {}),
        ...(databasePreflight ? { databasePreflight } : {}),
        ...(databasePreflightCode ? { databasePreflightCode } : {}),
        liveIntegrationsVerified: true,
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
