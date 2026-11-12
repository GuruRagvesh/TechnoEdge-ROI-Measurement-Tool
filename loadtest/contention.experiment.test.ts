import { afterAll, beforeAll, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
let sim: ChildProcess;
const PORT = 4680, SIM = `http://127.0.0.1:${PORT}`;
const env = { GRAPH_TENANT_ID: "t", GRAPH_CLIENT_ID: "c", GRAPH_CLIENT_SECRET: "s", GRAPH_SITE_ID: "sim.sharepoint.com,a,b", GRAPH_SITE_URL: "https://sim.sharepoint.com/sites/LoadTest", GRAPH_DRIVE_ID: "sim-drive", GRAPH_STORAGE_ROOT: "C", GRAPH_LAYOUT: "cohorts-v1", STORAGE_ADAPTER: "graph", MAIL_PROVIDER: "resend", RESEND_API_KEY: "x", EMAIL_FROM: "a@b.c", IDENTITY_PEPPER: "contention-experiment-pepper-0123456789", OTP_IP_HOURLY_LIMIT: "100000", EMAIL_HOURLY_LIMIT: "100000" };
beforeAll(async () => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  sim = spawn(process.execPath, ["loadtest/graph-sim.mjs"], { env: { ...process.env, ...env, SIM_PORT: String(PORT), SIM_RU_PER_MIN: "100000000" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(SIM + "/__stats"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const h = new Headers(init?.headers); h.set("x-sim-host", url.hostname);
    return real(SIM + url.pathname + url.search, { ...init, headers: h });
  });
});
afterAll(() => { sim.kill(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("100 simultaneous code requests from one office IP", async () => {
  const { requestCode } = await import("../src/lib/auth");
  const t = Date.now();
  const results = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => requestCode("User " + i, `u${i}@office.example`, "203.0.113.10")));
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  const reasons: Record<string, number> = {};
  for (const f of failed) reasons[String(f.reason?.message).slice(0, 80)] = (reasons[String(f.reason?.message).slice(0, 80)] || 0) + 1;
  (await import("node:fs")).writeFileSync(process.env.CONTENTION_OUT || "/tmp/contention.json", JSON.stringify({ ok: 100 - failed.length, failed: failed.length, reasons, seconds: (Date.now() - t) / 1000 }));
}, 600000);
