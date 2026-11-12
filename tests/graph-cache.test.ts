import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { Conflict, GraphStorage } from "../src/lib/storage";

// Runs GraphStorage against the load-test SharePoint simulator (no network).
let sim: ChildProcess;
const PORT = 4690 + Math.floor(Math.random() * 9);
const SIM = `http://127.0.0.1:${PORT}`;
let calls: string[] = [];
const simFetch = (async (input: unknown, init?: RequestInit) => {
  const url = new URL(String(input));
  calls.push(
    `${init?.method || "GET"} ${url.pathname.replace(/^\/v1\.0\/drives\/[^/]+/, "")}`,
  );
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
beforeAll(async () => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  sim = spawn(process.execPath, ["loadtest/graph-sim.mjs"], {
    env: {
      ...process.env,
      ...env,
      SIM_PORT: String(PORT),
      SIM_LATENCY_SCALE: "0",
      SIM_RU_PER_MIN: "1000000",
    },
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
});
afterAll(() => {
  sim.kill();
  vi.unstubAllEnvs();
});

describe("SharePoint call reduction (ETag-validated cache)", () => {
  it("a repeat read costs one metadata call and returns identical content", async () => {
    const g = new GraphStorage(simFetch);
    const etag = await g.write(
      "rooms/x/participants/p1.json",
      Buffer.from('{"a":1}'),
      null,
    );
    calls = [];
    const r1 = await g.read("rooms/x/participants/p1.json");
    expect(r1).toEqual({ data: Buffer.from('{"a":1}'), etag });
    expect(calls).toHaveLength(1); // metadata only; content known from the write
  });

  it("an update is a single conditional PUT, and a stale ETag is rejected", async () => {
    const g = new GraphStorage(simFetch);
    const e1 = await g.write(
      "rooms/x/participants/p2.json",
      Buffer.from("1"),
      null,
    );
    calls = [];
    const e2 = await g.write(
      "rooms/x/participants/p2.json",
      Buffer.from("2"),
      e1,
    );
    expect(calls.filter((c) => !c.includes("/sites/"))).toEqual([
      expect.stringMatching(/^PUT \/items\/.+\/content$/),
    ]);
    await expect(
      g.write("rooms/x/participants/p2.json", Buffer.from("3"), e1),
    ).rejects.toBeInstanceOf(Conflict);
    expect(await g.read("rooms/x/participants/p2.json")).toEqual({
      data: Buffer.from("2"),
      etag: e2,
    });
  });

  it("a change made by another server instance is seen immediately", async () => {
    const a = new GraphStorage(simFetch),
      b = new GraphStorage(simFetch);
    const e1 = await a.write(
      "rooms/x/participants/p3.json",
      Buffer.from("old"),
      null,
    );
    expect(
      (await a.read("rooms/x/participants/p3.json"))!.data.toString(),
    ).toBe("old");
    await b.write("rooms/x/participants/p3.json", Buffer.from("new"), e1);
    expect(
      (await a.read("rooms/x/participants/p3.json"))!.data.toString(),
    ).toBe("new");
    // and a stale write from the first instance cannot overwrite it
    await expect(
      a.write("rooms/x/participants/p3.json", Buffer.from("lost?"), e1),
    ).rejects.toBeInstanceOf(Conflict);
    expect(
      (await b.read("rooms/x/participants/p3.json"))!.data.toString(),
    ).toBe("new");
  });

  it("creating a second record in a known folder skips the folder lookup", async () => {
    const g = new GraphStorage(simFetch);
    await g.write("rooms/y/participants/a.json", Buffer.from("a"), null);
    calls = [];
    await g.write("rooms/y/participants/b.json", Buffer.from("b"), null);
    expect(
      calls.some(
        (c) =>
          c.startsWith("GET /root:/Unit/rooms/y/participants") &&
          !c.endsWith(".json"),
      ),
    ).toBe(false);
    await expect(
      g.write("rooms/y/participants/b.json", Buffer.from("again"), null),
    ).rejects.toBeInstanceOf(Conflict);
  });
});

describe("shared Retry-After pause", () => {
  it("other requests on the instance wait out SharePoint's Retry-After instead of calling", async () => {
    const t0 = Date.now();
    const times: number[] = [];
    let first = true;
    const f = (async () => {
      times.push(Date.now() - t0);
      if (first) {
        first = false;
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "1" },
        });
      }
      return Response.json({ access_token: "x", expires_in: 3600 });
    }) as typeof fetch;
    const g = new GraphStorage(f);
    const a = g.request(
      "https://graph.microsoft.com/v1.0/drives/d/root",
      {},
      false,
    );
    await new Promise((r) => setTimeout(r, 50)); // A has been throttled by now
    const b = g.request(
      "https://graph.microsoft.com/v1.0/drives/d/root",
      {},
      false,
    );
    await Promise.all([a, b]);
    // Only A's first call happened inside the 1 s pause; B and A's retry waited.
    expect(times.filter((t) => t < 950)).toHaveLength(1);
    expect(times).toHaveLength(3);
  });
});

describe("content cache memory bound", () => {
  it("never holds more than 32 MB and skips records over 256 KB", async () => {
    const g = new GraphStorage(simFetch);
    const big = Buffer.alloc(300 * 1024, 1);
    await g.write("rooms/z/big.json", big, null);
    calls = [];
    await g.read("rooms/z/big.json");
    expect(calls.filter((c) => c.endsWith("/content"))).toHaveLength(1); // not cached
    const chunk = Buffer.alloc(200 * 1024, 2);
    for (let i = 0; i < 180; i++)
      await g.write(`rooms/z/r${i}.json`, chunk, null); // 36 MB written
    const bytes = (g as unknown as { cacheBytes: number }).cacheBytes;
    expect(bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(bytes).toBeGreaterThan(30 * 1024 * 1024);
  }, 120000);
});
