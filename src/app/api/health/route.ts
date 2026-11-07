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
  } catch {
    return Response.json(
      { status: "not-ready" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
