import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphStorage } from "../src/lib/storage";
import { storageLayout } from "../src/lib/storage-layout";
import { sendVerificationEmail } from "../src/lib/mail";
import { infrastructureReadiness } from "../src/lib/readiness";
import { evidenceLimitMB, validateConfig } from "../src/lib/config";
import { requestEvent, reportError } from "../src/lib/observability";
describe("live infrastructure contracts without live credentials", () => {
  beforeEach(() => {
    for (const k of [
      "GRAPH_TENANT_ID",
      "GRAPH_CLIENT_ID",
      "GRAPH_CLIENT_SECRET",
      "GRAPH_DRIVE_ID",
    ])
      vi.stubEnv(k, "test");
    vi.stubEnv("GRAPH_SITE_ID", "");
    vi.stubEnv("GRAPH_STORAGE_ROOT", "");
    vi.stubEnv("GRAPH_LAYOUT", "legacy");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it("maps only paired corporate rooms into cohort folders and leaves legacy keys stable", () => {
    const id = "1234567890abcdef1234";
    expect(
      storageLayout(`rooms/${id}-pre/participants/a.json`, "cohorts-v1"),
    ).toBe(`cohorts/${id}/base-camp/participants/a.json`);
    expect(
      storageLayout(`rooms/${id}-post/evidence/a/result.xlsx`, "cohorts-v1"),
    ).toBe(`cohorts/${id}/summit/evidence/a/result.xlsx`);
    expect(storageLayout(`programs/${id}/program.json`, "cohorts-v1")).toBe(
      `cohorts/${id}/program.json`,
    );
    expect(storageLayout("rooms/baseline-pre/room.json", "cohorts-v1")).toBe(
      "rooms/baseline-pre/room.json",
    );
    expect(() => storageLayout("../outside", "cohorts-v1")).toThrow();
  });
  it("coalesces authentication and limits concurrent Graph network calls", async () => {
    let tokens = 0,
      active = 0,
      maximum = 0;
    const f = vi.fn(async (input: unknown) => {
      if (String(input).includes("/token")) {
        tokens++;
        await new Promise((r) => setTimeout(r, 5));
        return Response.json({ access_token: "unit-secret", expires_in: 3600 });
      }
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return Response.json({});
    });
    const g = new GraphStorage(f as typeof fetch, async () => {});
    await Promise.all(
      Array.from({ length: 40 }, () =>
        g.request("https://graph.microsoft.com/v1.0/drives/test/root"),
      ),
    );
    expect(tokens).toBe(1);
    expect(maximum).toBeLessThanOrEqual(16); // default per-instance cap
    // An explicit cap is enforced exactly.
    vi.stubEnv("GRAPH_MAX_CONCURRENCY", "4");
    maximum = 0;
    const capped = new GraphStorage(f as typeof fetch, async () => {});
    await Promise.all(
      Array.from({ length: 20 }, () =>
        capped.request("https://graph.microsoft.com/v1.0/drives/test/root"),
      ),
    );
    expect(maximum).toBeLessThanOrEqual(4);
    vi.unstubAllEnvs();
  });
  it("retries throttled token acquisition but fails invalid credentials without leaking the provider body", async () => {
    const sleep = vi.fn(async () => {});
    let count = 0;
    const f = vi.fn(async (input: unknown) =>
      String(input).includes("/token")
        ? ++count === 1
          ? new Response("", { status: 429, headers: { "Retry-After": "1" } })
          : Response.json({ access_token: "unit-secret", expires_in: 3600 })
        : Response.json({}),
    );
    await new GraphStorage(f as typeof fetch, sleep).request(
      "https://graph.microsoft.com/v1.0/drives/test/root",
    );
    // Retry-After is honoured: never shorter, at most 25% jitter longer.
    const waited = Number((sleep.mock.calls[0] as unknown[])[0]);
    expect(waited).toBeGreaterThanOrEqual(1000);
    expect(waited).toBeLessThanOrEqual(1250);
    const bad = vi.fn(
      async () =>
        new Response("sensitive provider diagnostics", { status: 401 }),
    );
    await expect(
      new GraphStorage(bad as typeof fetch, sleep).request(
        "https://graph.microsoft.com/v1.0/drives/test/root",
      ),
    ).rejects.toThrow("authentication unavailable");
    expect(bad).toHaveBeenCalledTimes(1);
  });
  it("uploads aligned chunks and recovers lost chunk acknowledgements using session status", async () => {
    const ranges: string[] = [];
    let lost = true,
      statusReads = 0;
    const f = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/token"))
        return Response.json({ access_token: "unit", expires_in: 3600 });
      if (url.endsWith("/createUploadSession"))
        return Response.json({ uploadUrl: "https://test.up.1drv.com/session" });
      if (url.includes("test.up.1drv.com")) {
        expect(new Headers(init?.headers).has("Authorization")).toBe(false);
        if (!init?.method) {
          statusReads++;
          return Response.json({ nextExpectedRanges: ["5242880-"] });
        }
        const range = new Headers(init.headers).get("Content-Range")!;
        ranges.push(range);
        if (lost) {
          lost = false;
          return new Response("", { status: 416 });
        }
        return Response.json({ eTag: "done" }, { status: 201 });
      }
      return Response.json({ id: "folder", eTag: "f", folder: {} });
    });
    expect(
      await new GraphStorage(f as typeof fetch, async () => {}).write(
        "rooms/test/evidence/file.bin",
        Buffer.alloc(6 * 1024 * 1024),
        null,
      ),
    ).toBe("done");
    expect(statusReads).toBe(1);
    expect(ranges).toEqual([
      "bytes 0-5242879/6291456",
      "bytes 5242880-6291455/6291456",
    ]);
  });
  it("scopes file lookup and download links under the explicit application root", async () => {
    vi.stubEnv("GRAPH_STORAGE_ROOT", "TechnoEdgeAssessmentROI/Staging");
    vi.stubEnv("GRAPH_LAYOUT", "cohorts-v1");
    const seen: string[] = [];
    const f = vi.fn(async (input: unknown) => {
      seen.push(String(input));
      return String(input).includes("/token")
        ? Response.json({ access_token: "unit", expires_in: 3600 })
        : Response.json({
            id: "r",
            eTag: "v",
            "@microsoft.graph.downloadUrl":
              "https://tenant.sharepoint.com/download?opaque=unit",
          });
    });
    const g = new GraphStorage(f as typeof fetch);
    await g.downloadLink("rooms/1234567890abcdef1234-post/reports/result.zip");
    expect(seen.at(-1)).toContain(
      "/root:/TechnoEdgeAssessmentROI/Staging/cohorts/1234567890abcdef1234/summit/reports/result.zip",
    );
  });
  it("creates scoped direct sessions and queries/cancels capabilities without bearer credentials", async () => {
    vi.stubEnv("GRAPH_STORAGE_ROOT", "TechnoEdgeAssessmentROI/Staging");
    vi.stubEnv("GRAPH_LAYOUT", "cohorts-v1");
    const seen: string[] = [];
    let expired = false;
    const f = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/token"))
        return Response.json({
          access_token: "private-server-token",
          expires_in: 3600,
        });
      if (url.startsWith("https://test.up.1drv.com/")) {
        expect(new Headers(init?.headers).has("Authorization")).toBe(false);
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        return expired
          ? new Response(null, { status: 410 })
          : Response.json({
              nextExpectedRanges: ["3276800-"],
              expirationDateTime: "2027-01-01T00:00:00Z",
            });
      }
      if (url.endsWith("/createUploadSession")) {
        expect(
          JSON.parse(String(init?.body)).item[
            "@microsoft.graph.conflictBehavior"
          ],
        ).toBe("replace"); // only an empty placeholder for the same content-addressed file can be replaced
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer private-server-token",
        );
        return Response.json({
          uploadUrl: "https://test.up.1drv.com/scoped-capability",
          expirationDateTime: "2027-01-01T00:00:00Z",
        });
      }
      return Response.json({ id: "folder", folder: {}, size: 26214400 });
    });
    const g = new GraphStorage(f as typeof fetch);
    const key =
      "rooms/1234567890abcdef1234-pre/evidence/person/sha-dashboard.xlsx";
    const session = await g.createEvidenceSession(key);
    expect(
      seen.some((u) =>
        u.includes(
          "TechnoEdgeAssessmentROI/Staging/cohorts/1234567890abcdef1234/base-camp/evidence/person",
        ),
      ),
    ).toBe(true);
    expect((await g.evidenceSessionStatus(session.uploadUrl))?.offset).toBe(
      3276800,
    );
    expect(await g.evidenceFileSize(key)).toBe(26214400);
    expired = true;
    expect(await g.evidenceSessionStatus(session.uploadUrl)).toBeNull();
    await g.cancelEvidenceSession(session.uploadUrl);
    const count = f.mock.calls.length;
    await expect(
      g.evidenceSessionStatus("https://attacker.invalid/capability"),
    ).rejects.toThrow("Untrusted");
    expect(f.mock.calls.length).toBe(count);
  });
  it.each(["mismatch", "business", "wrong-drive"])(
    "refuses writes when approved site/library binding is invalid: %s",
    async (mode) => {
      vi.stubEnv("GRAPH_SITE_ID", "approved");
      vi.stubEnv(
        "GRAPH_SITE_URL",
        "https://tenant.sharepoint.com/sites/Approved",
      );
      let writes = 0;
      const f = vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/token"))
          return Response.json({ access_token: "unit", expires_in: 3600 });
        if (init?.method) writes++;
        if (url.includes("/drives?"))
          return Response.json({
            value: [
              {
                id: mode === "wrong-drive" ? "other" : "test",
                driveType: mode === "business" ? "business" : "documentLibrary",
              },
            ],
          });
        return Response.json({
          webUrl:
            mode === "mismatch"
              ? "https://tenant.sharepoint.com/sites/Other"
              : "https://tenant.sharepoint.com/sites/Approved",
        });
      });
      await expect(
        new GraphStorage(f as typeof fetch).write(
          "rooms/test/a.json",
          Buffer.from("{}"),
          null,
        ),
      ).rejects.toThrow();
      expect(writes).toBe(0);
    },
  );
  it("accepts the approved site/library binding and rejects authenticated requests to other origins", async () => {
    vi.stubEnv("GRAPH_SITE_ID", "approved");
    vi.stubEnv(
      "GRAPH_SITE_URL",
      "https://tenant.sharepoint.com/sites/Approved",
    );
    const f = vi.fn(async (input: unknown) =>
      String(input).includes("/token")
        ? Response.json({ access_token: "unit", expires_in: 3600 })
        : String(input).includes("/drives?")
          ? Response.json({
              value: [{ id: "test", driveType: "documentLibrary" }],
            })
          : Response.json({
              webUrl: "https://tenant.sharepoint.com/sites/Approved",
            }),
    );
    const g = new GraphStorage(f as typeof fetch);
    await g.verifyTarget();
    await expect(g.request("https://attacker.invalid")).rejects.toThrow(
      "origin",
    );
  });
  it("retries Resend using one idempotency key and bounded Retry-After", async () => {
    vi.stubEnv("MAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_unit-private");
    vi.stubEnv("EMAIL_FROM", "TechnoEdge <assessments@unit.test>");
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(Response.json({ id: "accepted" }));
    const sleep = vi.fn(async () => {});
    await sendVerificationEmail(
      "receiver@gmail.com",
      "123456",
      "challenge",
      f,
      sleep,
    );
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(f.mock.calls[0][1].headers["Idempotency-Key"]).toBe(
      f.mock.calls[1][1].headers["Idempotency-Key"],
    );
  });
  it("rejects Resend configuration errors without reflecting provider text", async () => {
    vi.stubEnv("MAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_unit-private");
    vi.stubEnv("EMAIL_FROM", "sender@unit.test");
    const f = vi
      .fn()
      .mockResolvedValue(new Response("private diagnostic", { status: 403 }));
    await expect(
      sendVerificationEmail("receiver@outlook.com", "123456", "test", f),
    ).rejects.toThrow("administrator attention");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("reports missing configuration honestly without embedding secret values", () => {
    const report = infrastructureReadiness({
      RESEND_API_KEY: "re_do-not-print",
    });
    expect(report.configurationReady).toBe(false);
    expect(report.liveVerified).toBe(false);
    expect(JSON.stringify(report)).not.toContain("re_do-not-print");
    expect(report.checks.find((c) => c.key === "GRAPH_SITE_ID")?.status).toBe(
      "missing",
    );
  });
  it("requires an approved site, root and cohort layout for real Graph even outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STORAGE_ADAPTER", "graph");
    expect(() => validateConfig()).toThrow("GRAPH_SITE_ID");
    vi.stubEnv("GRAPH_SITE_ID", "approved");
    vi.stubEnv(
      "GRAPH_SITE_URL",
      "https://tenant-my.sharepoint.com/sites/Assessment",
    );
    vi.stubEnv("GRAPH_STORAGE_ROOT", "Assessment/Staging");
    vi.stubEnv("GRAPH_LAYOUT", "cohorts-v1");
    expect(() => validateConfig()).toThrow("dedicated SharePoint");
    vi.stubEnv(
      "GRAPH_SITE_URL",
      "https://tenant.sharepoint.com/sites/Assessment",
    );
    vi.stubEnv("GRAPH_LAYOUT", "legacy");
    expect(() => validateConfig()).toThrow("cohorts-v1");
    vi.stubEnv("GRAPH_LAYOUT", "cohorts-v1");
    expect(() => validateConfig()).not.toThrow();
  });
  it("accepts a production PostgreSQL record store only with a database address", () => {
    const prod = {
      NODE_ENV: "production",
      STORAGE_ADAPTER: "graph",
      APP_URL: "https://assessment.example",
      GRAPH_TENANT_ID: "t",
      GRAPH_CLIENT_ID: "c",
      GRAPH_CLIENT_SECRET: "s",
      GRAPH_DRIVE_ID: "d",
      GRAPH_SITE_ID: "site",
      GRAPH_SITE_URL: "https://tenant.sharepoint.com/sites/Assessment",
      GRAPH_STORAGE_ROOT: "Assessment/Production",
      GRAPH_LAYOUT: "cohorts-v1",
      EMAIL_FROM: "a@assessment.example",
      IDENTITY_PEPPER: "p".repeat(40),
      MAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_x",
      LOCAL_TEST_ACCOUNTS: "false",
      MOCK_AUTH: "false",
      RECORD_STORE: "",
      DATABASE_URL: "",
      POSTGRES_URL: "",
      DATABASE_SSL: "",
    };
    for (const [k, v] of Object.entries(prod)) vi.stubEnv(k, v);
    expect(() => validateConfig()).not.toThrow();
    vi.stubEnv("RECORD_STORE", "postgres");
    expect(() => validateConfig()).toThrow("Missing server configuration: DATABASE_URL");
    vi.stubEnv("POSTGRES_URL", "postgres://u:p@db.example:6543/postgres");
    expect(() => validateConfig()).not.toThrow();
    vi.stubEnv("RECORD_STORE", "graph");
    expect(() => validateConfig()).not.toThrow();
    vi.stubEnv("RECORD_STORE", "mysql");
    expect(() => validateConfig()).toThrow("RECORD_STORE must be graph or postgres");
  });
  it("uses the configurable 25 MiB evidence limit on Vercel and locally", () => {
    vi.stubEnv("VERCEL", "1");
    expect(evidenceLimitMB()).toBe(25);
    vi.stubEnv("VERCEL", "");
    expect(evidenceLimitMB()).toBe(25);
    vi.stubEnv("EVIDENCE_MAX_MIB", "40");
    expect(evidenceLimitMB()).toBe(40);
    vi.stubEnv("EVIDENCE_MAX_MIB", "0");
    expect(() => evidenceLimitMB()).toThrow();
  });
  it("emits correlation-only request events and bounds monitoring failures", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const event = requestEvent("rooms/export", 503, 12);
    expect(Object.keys(event)).not.toContain("email");
    vi.stubEnv("ERROR_MONITOR_URL", "https://monitor.invalid/events");
    await reportError(
      event,
      vi.fn().mockRejectedValue(new Error("secret diagnostic")),
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "secret diagnostic",
    );
  });
});
