import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizedRole,
  clearHostRegistryCache,
} from "../src/lib/host-registry";
import { AssessmentService } from "../src/lib/assessment";
import { MemoryStorage } from "./helpers";

// Incident 2026-11-12: every API request re-read the host list and tried to
// create the default room in SharePoint, and a malformed host list failed
// every signed-in request. These pin the corrected behaviour.
class Counting extends MemoryStorage {
  reads: string[] = [];
  writes: string[] = [];
  versions = 0;
  // Like SharePoint: a cheap metadata call reports the file's current version.
  async version(k: string) {
    this.versions++;
    return this.files.get(k)?.etag ?? null;
  }
  async read(k: string) {
    this.reads.push(k);
    return super.read(k);
  }
  async write(k: string, b: Buffer, e: string | null) {
    this.writes.push(k);
    return super.write(k, b, e);
  }
}
const LIST = "config/host-allowlist.json";
let version = 0;
const put = (s: MemoryStorage, text: string) =>
  s.files.set(LIST, { data: Buffer.from(text), etag: "v" + ++version });

afterEach(() => {
  vi.useRealTimers();
  clearHostRegistryCache();
});

describe("host list", () => {
  it("only listed emails are hosts; matching is exact and case-insensitive", async () => {
    const s = new Counting();
    put(
      s,
      JSON.stringify({
        emails: [
          "guru.thanumoorthy@technoedgels.com",
          "Pavan.Lalwani@technoedgels.com",
        ],
      }),
    );
    expect(await authorizedRole(s, "GURU.thanumoorthy@technoedgels.com")).toBe(
      "host",
    );
    expect(await authorizedRole(s, "pavan.lalwani@technoedgels.com")).toBe(
      "host",
    );
    for (const other of [
      "someone@gmail.com",
      "guru.thanumoorthy@gmail.com",
      "x@technoedgels.com",
      "technoedgels.com",
      "",
    ])
      expect(await authorizedRole(s, other)).toBe("attendee");
  });

  it("downloads the list only when it changes, and applies changes on the very next request", async () => {
    const s = new Counting();
    put(s, JSON.stringify({ emails: ["host@example.com"] }));
    for (let i = 0; i < 20; i++)
      expect(await authorizedRole(s, "host@example.com")).toBe("host");
    expect(s.reads.filter((k) => k === LIST)).toHaveLength(1); // one download
    expect(s.versions).toBe(19); // then one metadata check per request
    // Removing a host takes effect immediately (no cache window).
    put(s, JSON.stringify({ emails: [] }));
    expect(await authorizedRole(s, "host@example.com")).toBe("attendee");
    expect(s.reads.filter((k) => k === LIST)).toHaveLength(2);
  });

  it.each([
    [
      "missing brackets (the 12 Nov edit)",
      '{ "emails": "guru.thanumoorthy@technoedgels.com",\n"pavan.lalwani@technoedgels.com"\n}',
    ],
    ["emails not a list", '{"emails": "host@example.com"}'],
    ["not an object", '"host@example.com"'],
    ["empty file", ""],
  ])(
    "a broken host list (%s) removes host access but never fails sign-in",
    async (_, text) => {
      const s = new Counting();
      put(s, text);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(authorizedRole(s, "host@example.com")).resolves.toBe(
        "attendee",
      );
      await expect(authorizedRole(s, "someone@gmail.com")).resolves.toBe(
        "attendee",
      );
      expect(log).toHaveBeenCalled();
      log.mockRestore();
    },
  );
});

describe("default room", () => {
  it("is ensured once per server instance, not on every request", async () => {
    const s = new Counting();
    for (let i = 0; i < 10; i++) await new AssessmentService(s).defaultRoom();
    expect(
      s.writes.filter((k) => k.includes("ai-productivity-pre")),
    ).toHaveLength(1);
    expect(
      s.reads.filter((k) => k.includes("ai-productivity-pre")).length,
    ).toBeLessThanOrEqual(1);
  });
});
