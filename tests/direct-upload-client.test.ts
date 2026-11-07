import { it, expect, vi } from "vitest";
import {
  directEvidenceUpload,
  DIRECT_CHUNK_BYTES,
} from "../src/components/direct-evidence-upload";
it("uploads 25 MiB in direct chunks, recovers a lost acknowledgement and keeps app requests metadata-only", async () => {
  const file = new File([new Uint8Array(25 * 1024 * 1024)], "dashboard.xlsx");
  let offset = 0,
    lost = false;
  const ranges: string[] = [],
    apiSizes: number[] = [];
  const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes(".up.1drv.com")) {
      expect(init?.credentials).toBe("omit");
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      const range = new Headers(init?.headers).get("Content-Range")!;
      ranges.push(range);
      offset = Number(range.match(/-(\d+)\//)![1]) + 1;
      if (!lost) {
        lost = true;
        throw new Error("Lost response after accepted chunk");
      }
      return offset === file.size
        ? Response.json({ eTag: "done" }, { status: 201 })
        : Response.json(
            { nextExpectedRanges: [offset + "-"] },
            { status: 202 },
          );
    }
    apiSizes.push(Buffer.byteLength(String(init?.body || "")));
    if (url.endsWith("upload-start"))
      return Response.json({
        uploadId: "id",
        uploadUrl: "https://test.up.1drv.com/session",
        offset,
        committed: false,
      });
    if (url.endsWith("upload-status"))
      return Response.json({ offset, committed: offset === file.size });
    return Response.json({ participant: { revision: 2 } });
  });
  const result = await directEvidenceUpload(
    "/api/rooms/room",
    file,
    "dashboard",
    () => {},
    fetcher as typeof fetch,
    async () => {},
  );
  expect(result.revision).toBe(2);
  expect(ranges).toHaveLength(8);
  expect(ranges[1].startsWith(`bytes ${DIRECT_CHUNK_BYTES}-`)).toBe(true);
  expect(Math.max(...apiSizes)).toBeLessThan(1000);
}, 30000);
it("respects long throttling and does not finalize evidence after an upload fails", async () => {
  const calls: string[] = [];
  const fetcher = vi.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("upload-start"))
      return Response.json({
        uploadId: "id",
        uploadUrl: "https://test.up.1drv.com/session",
        offset: 0,
        committed: false,
      });
    if (url.endsWith("upload-status"))
      return Response.json({ offset: 0, committed: false });
    return new Response("", { status: 429, headers: { "Retry-After": "120" } });
  });
  await expect(
    directEvidenceUpload(
      "/api/rooms/room",
      new File(["data"], "file.csv"),
      "inbox",
      () => {},
      fetcher as typeof fetch,
      async () => {},
    ),
  ).rejects.toThrow("busy");
  expect(calls.some((s) => s.endsWith("upload-complete"))).toBe(false);
});
it("rejects a non-Microsoft session URL without sending file bytes", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      uploadId: "id",
      uploadUrl: "https://attacker.invalid",
      offset: 0,
      committed: false,
    }),
  );
  await expect(
    directEvidenceUpload(
      "/api/rooms/room",
      new File(["data"], "file.csv"),
      "inbox",
      () => {},
      fetcher as typeof fetch,
    ),
  ).rejects.toThrow("address");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

