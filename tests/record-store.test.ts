import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PostgresRecords } from "../src/lib/record-store";
import {
  Conflict,
  GraphStorage,
  HybridStorage,
  createJson,
  getJson,
  mutate,
} from "../src/lib/storage";
import { AppError } from "../src/lib/types";

// RECORD_STORE=postgres: live records in PostgreSQL, files in SharePoint.
// Needs a PostgreSQL server (CI starts one); SharePoint is the local simulator.
const DB = process.env.TEST_DATABASE_URL;
let sim: ChildProcess;
const PORT = 4680 + Math.floor(Math.random() * 9);
const SIM = `http://127.0.0.1:${PORT}`;
let calls: string[] = [];
const simFetch = (async (input: unknown, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname === "graph.microsoft.com" && !url.pathname.includes("/sites/"))
    calls.push(`${init?.method || "GET"} ${url.pathname}`);
  const headers = new Headers(init?.headers);
  headers.set("x-sim-host", url.hostname);
  return fetch(SIM + url.pathname + url.search, { ...init, headers });
}) as typeof fetch;
const env = {
  GRAPH_TENANT_ID: "t",
  GRAPH_CLIENT_ID: "c",
  GRAPH_CLIENT_SECRET: "s",
  GRAPH_SITE_ID: "sim.sharepoint.com,a,b",
  GRAPH_SITE_URL: "https://sim.sharepoint.com/sites/LoadTest",
  GRAPH_DRIVE_ID: "sim-drive",
  GRAPH_STORAGE_ROOT: "Unit",
  GRAPH_LAYOUT: "cohorts-v1",
};
let records: PostgresRecords;
const room = () => "r" + randomUUID().slice(0, 8);

describe.skipIf(!DB)("PostgreSQL record store", () => {
  beforeAll(async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    sim = spawn(process.execPath, ["loadtest/graph-sim.mjs"], {
      env: { ...process.env, ...env, SIM_PORT: String(PORT), SIM_LATENCY_SCALE: "0", SIM_RU_PER_MIN: "1000000" },
      stdio: "ignore",
    });
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(SIM + "/__stats");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    records = new PostgresRecords(DB!);
  });
  afterAll(async () => {
    sim?.kill();
    await records?.end();
    vi.unstubAllEnvs();
  });

  it("creates once, updates only from the version read, and rejects stale writes", async () => {
    const key = `rooms/${room()}/participants/a.json`;
    const v1 = await records.create(key, Buffer.from('{"n":1}'));
    expect(v1).toBeTruthy();
    expect(await records.create(key, Buffer.from('{"n":9}'))).toBeNull();
    const v2 = await records.update(key, Buffer.from('{"n":2}'), v1!);
    expect(v2).toBeTruthy();
    expect(await records.update(key, Buffer.from('{"n":3}'), v1!)).toBeNull();
    expect(await records.read(key)).toEqual({ data: Buffer.from('{"n":2}'), etag: v2 });
  });

  it("loses no update when 50 requests change one record at once", async () => {
    const g = new HybridStorage(records, simFetch);
    const key = `rooms/${room()}/participants/counter.json`;
    await Promise.all(
      Array.from({ length: 50 }, () =>
        mutate<{ n: number }>(g, key, (old) => ({ n: (old?.n ?? 0) + 1 })),
      ),
    );
    expect(await getJson(g, key)).toEqual({ n: 50 });
  }, 30000);

  it("keeps records off SharePoint entirely, and files on SharePoint", async () => {
    const g = new HybridStorage(records, simFetch, undefined, false);
    const r = room();
    calls = [];
    await createJson(g, `rooms/${r}/participants/p.json`, { answers: {} });
    await mutate(g, `rooms/${r}/participants/p.json`, () => ({ answers: { a: [1] } }));
    await getJson(g, `rooms/${r}/participants/p.json`);
    expect(await g.list(`rooms/${r}/participants`)).toEqual([`rooms/${r}/participants/p.json`]);
    expect(calls).toEqual([]);
    await g.write(`rooms/${r}/evidence/p/file.bin`, Buffer.from("bytes"), null);
    expect(calls.length).toBeGreaterThan(0);
    expect((await g.read(`rooms/${r}/evidence/p/file.bin`))!.data.toString()).toBe("bytes");
  });

  it("leaves the host allowlist in SharePoint, where administrators edit it", async () => {
    const g = new HybridStorage(records, simFetch);
    const sp = new GraphStorage(simFetch);
    await sp.write("config/host-allowlist.json", Buffer.from('{"emails":["h@x.example"]}'), await sp.version("config/host-allowlist.json"));
    expect(await records.read("config/host-allowlist.json")).toBeNull();
    expect(await getJson(g, "config/host-allowlist.json")).toEqual({ emails: ["h@x.example"] });
  });

  it("carries over records written to SharePoint before the switch, except sign-in records", async () => {
    const r = room();
    const sp = new GraphStorage(simFetch);
    await sp.write(`rooms/${r}/participants/old.json`, Buffer.from('{"answers":{"a":[2]}}'), null);
    await sp.write(`auth/sessions/${r}.json`, Buffer.from('{"s":1}'), null);
    const g = new HybridStorage(records, simFetch);
    expect(await g.list(`rooms/${r}/participants`)).toEqual([`rooms/${r}/participants/old.json`]);
    expect(await getJson(g, `rooms/${r}/participants/old.json`)).toEqual({ answers: { a: [2] } });
    // now held in PostgreSQL: a second read makes no SharePoint call
    calls = [];
    await getJson(g, `rooms/${r}/participants/old.json`);
    expect(calls).toEqual([]);
    // creating over a carried-over record is a conflict, never an overwrite
    const fresh = `rooms/${r}/participants/old2.json`;
    await sp.write(fresh, Buffer.from('{"keep":true}'), null);
    await expect(g.write(fresh, Buffer.from('{"keep":false}'), null)).rejects.toBeInstanceOf(Conflict);
    expect(await getJson(g, fresh)).toEqual({ keep: true });
    expect(await getJson(g, `auth/sessions/${r}.json`)).toBeNull();
  });

  it("copies each submitted result to SharePoint and keeps unsubmitted work in PostgreSQL only", async () => {
    const r = room();
    const g = new HybridStorage(records, simFetch, undefined, false);
    const sp = new GraphStorage(simFetch);
    const key = `rooms/${r}/participants/p.json`;
    await createJson(g, key, { answers: { a: [1] } });
    expect(await sp.read(key)).toBeNull();
    await mutate(g, key, (p: object | null) => ({ ...p, submittedAt: "2026-11-12T10:00:00.000Z" }));
    expect(JSON.parse((await sp.read(key))!.data.toString()).submittedAt).toBe("2026-11-12T10:00:00.000Z");
    await mutate(g, key, (p: object | null) => ({ ...p, grades: { a: 3 } }));
    expect(JSON.parse((await sp.read(key))!.data.toString()).grades).toEqual({ a: 3 });
  });

  it("reports an unreachable database as 503 without detail", async () => {
    const down = new PostgresRecords({ host: "127.0.0.1", port: 1, connectionTimeoutMillis: 500 });
    const err = await down.read("rooms/x/participants/p.json").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(503);
    expect(err.code).toBe("DATABASE_UNAVAILABLE");
    await down.end();
  });
});

describe("database connection settings", () => {
  it("uses DATABASE_URL, else the POSTGRES_URL a Supabase integration sets", async () => {
    const { databaseUrl } = await import("../src/lib/record-store");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "postgres://u:p@pooler.example:6543/postgres?sslmode=require");
    vi.stubEnv("DATABASE_SSL", "");
    expect(databaseUrl()).toBe("postgres://u:p@pooler.example:6543/postgres?sslmode=require");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@primary.example/db");
    expect(databaseUrl()).toBe("postgres://u:p@primary.example/db");
    vi.unstubAllEnvs();
  });

  it("only skips certificate checks when DATABASE_SSL=no-verify is set", async () => {
    const { databaseUrl } = await import("../src/lib/record-store");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@pooler.example:6543/postgres?sslmode=require");
    vi.stubEnv("DATABASE_SSL", "no-verify");
    const url = new URL(databaseUrl());
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("uselibpqcompat")).toBe("true");
    vi.unstubAllEnvs();
  });
});
