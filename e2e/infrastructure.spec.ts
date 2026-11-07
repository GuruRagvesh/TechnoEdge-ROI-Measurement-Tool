import { test, expect } from "@playwright/test";
test("staging transports: scoped SharePoint download links and configurable evidence size rejection", async ({
  page,
  browser,
}) => {
  const origin = "http://127.0.0.1:3100";
  const host = await browser.newContext({ baseURL: origin });
  expect(
    (
      await host.request.post("/api/auth/test-login", {
        headers: { Origin: origin },
        data: { userId: "HOST001", password: process.env.E2E_HOST_PASSWORD },
      })
    ).status(),
  ).toBe(200);
  const hp = await host.newPage();
  await hp.goto("/host/reports/export");
  await expect(
    hp.getByRole("button", { name: "Download Excel report" }),
  ).toBeVisible();
  await hp.route("**/api/rooms/*/export", (r) =>
    r.fulfill({
      json: {
        downloadUrl: "https://tenant.sharepoint.com/download?opaque=synthetic",
        name: "report.xlsx",
      },
    }),
  );
  await hp.route("https://tenant.sharepoint.com/download*", (r) => {
    expect(r.request().headers()["cookie"]).toBeUndefined();
    return r.fulfill({
      contentType: "application/octet-stream",
      headers: { "Content-Disposition": "attachment; filename=report.xlsx" },
      body: Buffer.from("synthetic download transport test"),
    });
  });
  const downloaded = hp.waitForEvent("download");
  await hp.getByRole("button", { name: "Download Excel report" }).click();
  expect((await downloaded).suggestedFilename()).toBe("report.xlsx");
  const p = await host.request.post("/api/programs", {
    headers: { Origin: origin },
    data: {
      company: "Staging Transport Test",
      cohort: "Size " + Date.now(),
      requestId: crypto.randomUUID(),
    },
  });
  const { program } = await p.json();
  expect(
    (
      await page.request.post("/api/auth/test-login", {
        headers: { Origin: origin },
        data: {
          userId: "DEMO001",
          password: process.env.E2E_ATTENDEE_PASSWORD,
        },
      })
    ).status(),
  ).toBe(200);
  const room = program.preRoomId;
  await page.request.post(`/api/rooms/${room}/join`, {
    headers: { Origin: origin },
    data: {},
  });
  await page.request.post(`/api/rooms/${room}/start`, {
    headers: { Origin: origin },
    data: { selected: ["inbox", "tables", "clean"] },
  });
  await page.route(`**/api/rooms/${room}`, async (route) => {
    const r = await route.fetch();
    const x = await r.json();
    x.evidenceLimitMB = 25;
    await route.fulfill({ json: x });
  });
  await page.goto("/attendee/rooms/" + room);
  await expect(page.getByLabel("Upload evidence")).toBeVisible();
  let uploads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/upload")) uploads++;
  });
  await page.getByLabel("Upload evidence").setInputFiles({
    name: "oversize.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(25 * 1024 * 1024 + 1),
  });
  await expect(page.locator(".error")).toContainText("up to 25 MiB");
  expect(uploads).toBe(0);
  await hp.getByLabel("Assessment round").selectOption(room);
  const part = `/api/rooms/${room}/evidence-zip?plan=12345678-1234-1234-1234-123456789012&part=1`;
  await hp.route(`**/api/rooms/${room}/evidence-zip`, (r) =>
    r.fulfill({
      json: {
        parts: [
          { label: "Download ZIP part 1 of 2", href: part },
          {
            label: "Download ZIP part 2 of 2",
            href: part.replace("part=1", "part=2"),
          },
        ],
      },
    }),
  );
  await hp.route(`**${part}`, (r) =>
    r.fulfill({
      contentType: "application/zip",
      headers: {
        "Content-Disposition": 'attachment; filename="evidence-part-1.zip"',
      },
      body: Buffer.from("archive part transport fixture"),
    }),
  );
  await hp.getByRole("button", { name: "Download evidence ZIP" }).click();
  await expect(hp.getByLabel("Evidence archive parts")).toBeVisible();
  const partDownload = hp.waitForEvent("download");
  await hp.getByRole("button", { name: "Download ZIP part 1 of 2" }).click();
  expect((await partDownload).suggestedFilename()).toBe("evidence-part-1.zip");
  await host.close();
});
