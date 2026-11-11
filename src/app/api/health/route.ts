import { validateConfig } from "@/lib/config";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    validateConfig();
    return Response.json(
      {
        status: "ok",
        checks: "runtime-configuration-only",
        liveIntegrationsVerified: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
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
