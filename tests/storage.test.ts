import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import {
  Conflict,
  GraphStorage,
  LocalStorage,
  mutate,
  safeKey,
} from "../src/lib/storage";
import { MemoryStorage } from "./helpers";
describe("storage concurrency and recovery", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    dirs.length = 0;
    vi.unstubAllEnvs();
  });
  it("serializes concurrent local writers with CAS and reloads from disk", async () => {
    await mkdir(".test-work", { recursive: true });
    const dir = await mkdtemp(path.resolve(".test-work/local-test-"));
    dirs.push(dir);
    const store = new LocalStorage(dir);
    await store.write("rooms/test/count.json", Buffer.from('{"n":0}'), null);
    await Promise.all(
      Array.from({ length: 6 }, () =>
        mutate<{ n: number }>(store, "rooms/test/count.json", (x) => ({
          n: x!.n + 1,
        })),
      ),
    );
    const loaded = await new LocalStorage(dir).read("rooms/test/count.json");
    expect(JSON.parse(loaded!.data.toString()).n).toBe(6);
    await expect(
      store.write("rooms/test/count.json", Buffer.from("bad"), "stale"),
    ).rejects.toBeInstanceOf(Conflict);
  });
  it("rejects path traversal and retries JSON conflicts", async () => {
    for (const bad of ["../secret", "/absolute", "a/../b", "a//b", "C:/secret"])
      expect(() => safeKey(bad)).toThrow();
    const s = new MemoryStorage();
    await Promise.all(
      Array.from({ length: 4 }, () =>
        mutate<{ n: number }>(s, "counter.json", (x) => ({
          n: (x?.n || 0) + 1,
        })),
      ),
    );
    expect(JSON.parse((await s.read("counter.json"))!.data.toString()).n).toBe(
      4,
    );
  });
  it("honors Retry-After, never shortens long throttling delays, and handles 503", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}"));
    const graph = new GraphStorage(fetcher, sleep);
    expect((await graph.request("https://upload.example", {}, false)).ok).toBe(
      true,
    );
    // Retry-After is honoured: never shorter; at most 25% jitter longer, plus
    // up to 250 ms so requests paused on one instance do not resume together.
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(2000);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(2000 * 1.25 + 250);
    const long = new GraphStorage(
      vi
        .fn()
        .mockResolvedValue(
          new Response("", { status: 429, headers: { "Retry-After": "120" } }),
        ),
      sleep,
    );
    await expect(
      long.request("https://upload.example", {}, false),
    ).rejects.toThrow("busy");
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it("maps precondition failures to CAS conflicts", async () => {
    const g = new GraphStorage(
      vi.fn().mockResolvedValue(new Response("", { status: 412 })),
      async () => {},
    );
    await expect(
      g.request("https://upload.example", {}, false),
    ).rejects.toBeInstanceOf(Conflict);
  });
  it("bounds transient failure retries", async () => {
    const f = vi.fn().mockRejectedValue(new Error("network"));
    const g = new GraphStorage(f, async () => {});
    await expect(
      g.request("https://upload.example", {}, false),
    ).rejects.toThrow("unavailable");
    expect(f).toHaveBeenCalledTimes(5);
  });
  it("conditionally updates Graph content and paginates lists", async () => {
    for (const k of [
      "GRAPH_TENANT_ID",
      "GRAPH_CLIENT_ID",
      "GRAPH_CLIENT_SECRET",
      "GRAPH_DRIVE_ID",
    ])
      vi.stubEnv(k, "test");
    let conditional = "";
    let page = 0;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/token"))
          return Response.json({
            access_token: "secret-token",
            expires_in: 3600,
          });
        if (url.includes("/children")) {
          page++;
          return Response.json(
            page === 1
              ? {
                  value: [{ name: "one.json", file: {} }],
                  "@odata.nextLink":
                    "https://graph.microsoft.com/v1.0/drives/test/next",
                }
              : { value: [] },
          );
        }
        if (url.endsWith("/next"))
          return Response.json({ value: [{ name: "two.json", file: {} }] });
        if (init?.method === "PUT") {
          conditional = new Headers(init.headers).get("If-Match") || "";
          return Response.json({ eTag: "v2" });
        }
        if (url.endsWith("rooms/test"))
          return Response.json({ id: "folder", eTag: "f1", folder: {} });
        return Response.json({ id: "record", eTag: "v1", file: {} });
      },
    );
    const g = new GraphStorage(fetcher as typeof fetch, async () => {});
    expect(
      await g.write("rooms/test/person.json", Buffer.from("{}"), "v1"),
    ).toBe("v2");
    expect(conditional).toBe("v1");
    expect(await g.list("rooms/test")).toEqual([
      "rooms/test/one.json",
      "rooms/test/two.json",
    ]);
  });
  it("creates Graph files with fail-on-conflict and omits bearer tokens from upload URLs", async () => {
    for (const k of [
      "GRAPH_TENANT_ID",
      "GRAPH_CLIENT_ID",
      "GRAPH_CLIENT_SECRET",
      "GRAPH_DRIVE_ID",
    ])
      vi.stubEnv(k, "test");
    let behavior = "",
      uploadAuthorization: string | null = "";
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/token"))
          return Response.json({
            access_token: "test-token",
            expires_in: 3600,
          });
        if (url === "https://test.up.1drv.com/session") {
          uploadAuthorization = new Headers(init?.headers).get("Authorization");
          return Response.json({ eTag: "created-v1" }, { status: 201 });
        }
        if (url.endsWith("/createUploadSession")) {
          behavior = JSON.parse(String(init?.body)).item[
            "@microsoft.graph.conflictBehavior"
          ];
          return Response.json({ uploadUrl: "https://test.up.1drv.com/session" });
        }
        return Response.json({ id: "folder", eTag: "folder-v1", folder: {} });
      },
    );
    const graph = new GraphStorage(fetcher as typeof fetch, async () => {});
    expect(
      await graph.write("rooms/test/new.json", Buffer.from("{}"), null),
    ).toBe("created-v1");
    expect(behavior).toBe("fail");
    expect(uploadAuthorization).toBeNull();
  });
});
