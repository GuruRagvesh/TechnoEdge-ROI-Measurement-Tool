import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { largeOfficeFiles } from "../tests/large-office-fixtures";
test("large Office uploads: browser sends chunks to Microsoft, reload resumes, and verified receipts persist locally", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const { xlsx, pptx } = await largeOfficeFiles();
  const origin = "http://127.0.0.1:3100";
  const host = await browser.newContext({ baseURL: origin });
  await host.request.post("/api/auth/test-login", {
    headers: { Origin: origin },
    data: { userId: "HOST001", password: process.env.E2E_HOST_PASSWORD },
  });
  const created = await host.request.post("/api/programs", {
    headers: { Origin: origin },
    data: {
      company: "Large evidence acceptance",
      cohort: "Office " + Date.now(),
      requestId: crypto.randomUUID(),
    },
  });
  const { program } = await created.json();
  const room = program.preRoomId;
  await page.request.post("/api/auth/test-login", {
    headers: { Origin: origin },
    data: { userId: "DEMO001", password: process.env.E2E_ATTENDEE_PASSWORD },
  });
  await page.request.post(`/api/rooms/${room}/join`, {
    headers: { Origin: origin },
    data: {},
  });
  await page.request.post(`/api/rooms/${room}/start`, {
    headers: { Origin: origin },
    data: { selected: ["inbox", "dashboard", "mbr"] },
  });
  await page.route(`**/api/rooms/${room}`, async (route) => {
    const r = await route.fetch(),
      data = await r.json();
    data.uploadTransport = "graph-direct";
    await route.fulfill({ json: data });
  });
  const sessions = new Map<
    string,
    {
      name: string;
      task: string;
      size: number;
      sha: string;
      parts: Buffer[];
      offset: number;
    }
  >();
  let next = 0;
  const metadataSizes: number[] = [];
  let paused = false;
  let secondChunk: () => void = () => {};
  const pausedAtSecond = new Promise<void>((r) => {
    secondChunk = r;
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route(`**/api/rooms/${room}/upload-*`, async (route) => {
    const body = route.request().postDataJSON();
    metadataSizes.push(Buffer.byteLength(route.request().postData() || ""));
    const action = route.request().url().split("/").at(-1);
    if (action === "upload-start") {
      let id = [...sessions].find(
        ([, s]) => s.sha === body.sha256 && s.task === body.task,
      )?.[0];
      if (!id) {
        id = "session" + ++next;
        sessions.set(id, {
          name: body.name,
          task: body.task,
          size: body.size,
          sha: body.sha256,
          parts: [],
          offset: 0,
        });
      }
      const s = sessions.get(id)!;
      await route.fulfill({
        json: {
          uploadId: id,
          uploadUrl: "https://test.up.1drv.com/" + id,
          offset: s.offset,
          committed: s.offset === s.size,
        },
      });
      return;
    }
    const s = sessions.get(body.uploadId)!;
    if (action === "upload-status") {
      await route.fulfill({
        json: { offset: s.offset, committed: s.offset === s.size },
      });
      return;
    }
    if (action === "upload-complete") {
      const bytes = Buffer.concat(s.parts);
      expect(bytes.length).toBe(s.size);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(s.sha);
      // Test-only provider stand-in: persist the received bytes through the unchanged local adapter.
      const r = await page.request.post(`/api/rooms/${room}/upload`, {
        headers: { Origin: origin },
        multipart: {
          task: s.task,
          file: {
            name: s.name,
            mimeType: "application/octet-stream",
            buffer: bytes,
          },
        },
      });
      expect(r.status()).toBe(200);
      await route.fulfill({ json: await r.json() });
      return;
    }
    await route.fulfill({ status: 400, json: { error: "Unexpected action" } });
  });
  await page.route("https://test.up.1drv.com/*", async (route) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Range, Content-Type",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    expect(route.request().headers()["authorization"]).toBeUndefined();
    expect(route.request().headers()["cookie"]).toBeUndefined();
    const s = sessions.get(route.request().url().split("/").at(-1)!)!;
    if (s.name.endsWith(".xlsx") && s.offset > 0 && !paused) {
      paused = true;
      secondChunk();
      await gate;
      try {
        await route.abort();
      } catch {}
      return;
    }
    const bytes = route.request().postDataBuffer()!;
    expect(bytes.length).toBeLessThan(4.5 * 1024 * 1024);
    s.parts.push(bytes);
    s.offset += bytes.length;
    await route.fulfill(
      s.offset === s.size
        ? { status: 201, headers: cors, json: { eTag: "committed" } }
        : {
            status: 202,
            headers: cors,
            json: { nextExpectedRanges: [s.offset + "-"] },
          },
    );
  });
  await page.goto(`/attendee/rooms/${room}`);
  await page.getByRole("tab", { name: /Boardroom Dashboard/ }).click();
  await page.getByLabel("Upload evidence").setInputFiles({
    name: "large-dashboard.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: xlsx,
  });
  await pausedAtSecond;
  const savedOffset = [...sessions.values()][0].offset;
  expect(savedOffset).toBeGreaterThan(0);
  await page.reload();
  release();
  await page.getByRole("tab", { name: /Boardroom Dashboard/ }).click();
  await page.getByLabel("Upload evidence").setInputFiles({
    name: "large-dashboard.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: xlsx,
  });
  await expect(
    page.locator(".evidence-file").filter({ hasText: "large-dashboard.xlsx" }),
    // Hashing and uploading ~20 MiB can exceed 15 s on a cold dev server.
  ).toBeVisible({ timeout: 45000 });
  await page.getByRole("tab", { name: /MBR Deadline/ }).click();
  await page.getByLabel("Upload evidence").setInputFiles({
    name: "large-review.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: pptx,
  });
  await expect(
    page.locator(".evidence-file").filter({ hasText: "large-review.pptx" }),
    // Hashing and uploading ~20 MiB can exceed 15 s on a cold dev server.
  ).toBeVisible({ timeout: 45000 });
  const record = (await (await page.request.get(`/api/rooms/${room}`)).json())
    .participant;
  expect(record.evidence).toHaveLength(2);
  expect(
    record.evidence.every((e: { size: number }) => e.size > 10 * 1024 * 1024),
  ).toBe(true);
  expect(Math.max(...metadataSizes)).toBeLessThan(1000);
  expect(sessions.size).toBe(2);
  const hp = await host.newPage();
  await hp.goto("/host/reports/export");
  await hp.getByLabel("Assessment round").selectOption(room);
  const reportDownload = hp.waitForEvent("download");
  await hp.getByRole("button", { name: "Download Excel report" }).click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await readFile((await (await reportDownload).path())!)) as never,
  );
  expect(workbook.getWorksheet("Evidence")!.rowCount).toBe(3);
  // The local adapter generates the real archive; a mocked Microsoft endpoint exercises the large direct download transport.
  const response = await host.request.get(`/api/rooms/${room}/evidence-zip`);
  expect(response.status()).toBe(200);
  const zipBytes = await response.body();
  expect(zipBytes.length).toBeGreaterThan(10 * 1024 * 1024);
  await hp.route(`**/api/rooms/${room}/evidence-zip`, (r) =>
    r.fulfill({
      json: {
        downloadUrl: "https://tenant.sharepoint.com/large-evidence",
        name: "large-evidence.zip",
      },
    }),
  );
  await hp.route("https://tenant.sharepoint.com/large-evidence", (r) =>
    r.fulfill({
      headers: {
        "Content-Disposition": "attachment; filename=large-evidence.zip",
      },
      contentType: "application/zip",
      body: zipBytes,
    }),
  );
  const archiveDownload = hp.waitForEvent("download");
  await hp.getByRole("button", { name: "Download evidence ZIP" }).click();
  const downloaded = await JSZip.loadAsync(
    await readFile((await (await archiveDownload).path())!),
    { checkCRC32: true },
  );
  expect(
    JSON.parse(await downloaded.file("manifest.json")!.async("string")).files,
  ).toHaveLength(2);
  await host.close();
});
