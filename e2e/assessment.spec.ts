import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { answerKey } from "../src/lib/challenges";
import type { Participant, TaskId } from "../src/lib/types";
const origin = "http://127.0.0.1:3100";
const tasks: TaskId[] = ["inbox", "tables", "clean", "dashboard", "mbr"];
const titles = [
  "Inbox Inferno",
  "The Hundred-Table Puzzle",
  "The Dirty Data Disaster",
  "The Boardroom Dashboard",
  "The MBR Deadline",
];
const post = (ctx: APIRequestContext, route: string, data: unknown) =>
  ctx.post("/api/" + route, { headers: { Origin: origin }, data });
async function emailLogin(page: Page, email: string, role = "attendee") {
  await page.goto("/login");
  await page.getByLabel("Email or User ID", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Full name", { exact: true })
    .fill(role === "host" ? "Corporate Reviewer" : "Corporate Learner");
  const issued = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/request-code") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send verification code" }).click();
  const { challengeId } = await (await issued).json();
  const { code } = await (
    await page.request.get(
      "/api/auth/development-mail?challenge=" + challengeId,
    )
  ).json();
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await expect(page).toHaveURL("/" + role);
}
async function mobile(page: Page, file: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".test-work/" + file + "-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function join(page: Page, room: string) {
  await page.goto("/attendee/join?code=" + room);
  await page.getByLabel("Room code").fill(room);
  await page.getByRole("button", { name: "Validate room" }).click();
  await expect(
    page.getByRole("button", { name: "Enter room and start timer" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enter room and start timer" })
    .click();
  await expect(page).toHaveURL("/attendee/rooms/" + room);
}
async function finish(page: Page, phase: "pre" | "post") {
  for (let t = 0; t < tasks.length; t++) {
    await page.getByRole("tab", { name: new RegExp(titles[t]) }).click();
    for (let i = 0; i < 4; i++)
      await page
        .getByRole("radio")
        .nth(i * 4 + answerKey(phase)[tasks[t]][i].correct)
        .check();
    // Completion stays unavailable until the server holds evidence.
    await expect(
      page.getByLabel("Mark this challenge complete"),
    ).toBeDisabled();
    await page.getByLabel("Upload evidence").setInputFiles({
      name: tasks[t] + "-result.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Result,Value\nVerified,100"),
    });
    await expect(
      page
        .locator(".evidence-file")
        .filter({ hasText: tasks[t] + "-result.csv" }),
    ).toBeVisible();
    await page.getByLabel("Mark this challenge complete").check();
    await expect(page.locator(".save-status")).toContainText(
      "All changes saved",
    );
    if (t === 0) {
      // Unticking before submission persists, and ticking again restores it.
      await page.getByLabel("Mark this challenge complete").uncheck();
      await expect(page.locator(".save-status")).toContainText(
        "All changes saved",
      );
      await page.reload();
      await page.getByRole("tab", { name: new RegExp(titles[t]) }).click();
      await expect(
        page.getByLabel("Mark this challenge complete"),
      ).not.toBeChecked();
      await page.getByLabel("Mark this challenge complete").check();
      await expect(page.locator(".save-status")).toContainText(
        "All changes saved",
      );
    }
  }
  await page
    .getByRole("button", { name: "Submit assessment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review before submission" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/attendee\/attempt\/[^/]+\/review$/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Review before submission" }),
  ).toBeVisible();
  // The checklist is read from the saved server record.
  const review = page.getByRole("dialog");
  await expect(review.getByText("Questions saved: 4 / 4")).toHaveCount(5);
  await expect(review.getByText(/^✓ Marked complete$/)).toHaveCount(5);
  for (let t = 0; t < tasks.length; t++)
    await expect(
      review.getByText(tasks[t] + "-result.csv", { exact: false }),
    ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit & lock assessment" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Submit & lock assessment" }).click();
  await expect(
    page.getByRole("heading", { name: "Submission received" }),
  ).toBeVisible();
}
async function grade(page: Page, room: string, person: string) {
  await page.goto(`/host/rooms/${room}/evaluate/${person}`);
  await expect(page.getByLabel("Evaluator feedback")).toBeVisible();
  for (const t of tasks) {
    await page.getByLabel("Challenge", { exact: true }).selectOption(t);
    await page.getByLabel("completeness /3").fill("3");
    await page.getByLabel("accuracy /3").fill("3");
    await page.getByLabel("Presentation /2").fill("2");
    await page
      .getByLabel("Evaluator feedback")
      .fill("Verified calculations, deliverables and presentation.");
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/grade") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save practical evaluation" })
      .click();
    expect((await response).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Save practical evaluation" }),
    ).toBeEnabled();
  }
}
test("corporate journey: host OTP, paired creation, confirmed join, reload/outage, practical submission, grading, Summit and exports", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const hostEmail = `reviewer-${Date.now()}@technoedge.test`;
  await mkdir(".test-work/e2e/config", { recursive: true });
  await writeFile(
    ".test-work/e2e/config/host-allowlist.json",
    JSON.stringify({ emails: [hostEmail] }),
  );
  const hc = await browser.newContext({ baseURL: origin });
  const hp = await hc.newPage();
  hp.on("pageerror", (e) => errors.push(e.message));
  await emailLogin(hp, hostEmail, "host");
  await expect(
    hp.getByRole("link", { name: "+ Create assessment", exact: true }),
  ).toHaveCount(1);
  await hp
    .getByRole("link", { name: "+ Create assessment", exact: true })
    .click();
  await hp
    .getByLabel("Client company", { exact: true })
    .fill("Acceptance Finance");
  await hp
    .getByLabel("Batch / cohort name", { exact: true })
    .fill("Corporate pilot " + Date.now());
  await mobile(hp, "corporate-create");
  const created = hp.waitForRequest(
    (r) => r.url().endsWith("/api/programs") && r.method() === "POST",
  );
  await hp.getByRole("button", { name: "Create program & two rooms" }).click();
  const payload = (await created).postDataJSON();
  await expect(hp).toHaveURL(/\/host\/assessments\/[a-f0-9]+$/);
  const program = {
    id: hp.url().split("/").at(-1)!,
    preRoomId: hp.url().split("/").at(-1)! + "-pre",
    postRoomId: hp.url().split("/").at(-1)! + "-post",
  };
  expect(
    (await (await post(hp.request, "programs", payload)).json()).program.id,
  ).toBe(program.id);
  await expect(hp).toHaveURL("/host/assessments/" + program.id);
  await expect(hp.getByRole("button", { name: "Copy code" })).toHaveCount(2);
  await expect(
    hp.getByRole("button", { name: "Open room", exact: true }),
  ).toHaveCount(1);
  await emailLogin(page, `corporate-${Date.now()}@gmail.com`);
  await mobile(page, "corporate-dashboard");
  await page.goto("/attendee/join?code=" + program.preRoomId);
  await page.getByRole("button", { name: "Validate room" }).click();
  await expect(
    page.getByText("All five practical challenges are assigned automatically."),
  ).toBeVisible();
  expect(
    (await page.request.get("/api/rooms/" + program.preRoomId)).status(),
  ).toBe(403);
  await page
    .getByRole("button", { name: "Enter room and start timer" })
    .click();
  await expect(page).toHaveURL("/attendee/rooms/" + program.preRoomId);
  await expect(page.locator(".attempt-clock")).toContainText("remaining");
  const initial: Participant = (
    await (await page.request.get("/api/rooms/" + program.preRoomId)).json()
  ).participant;
  expect(initial.selected).toEqual(tasks);
  expect(initial.startedAt).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(5);
  const duplicate = await post(
    page.request,
    `rooms/${program.preRoomId}/join`,
    {},
  );
  expect((await duplicate.json()).participant.deadline).toBe(initial.deadline);
  await expect(page.getByRole("tab").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Inbox Inferno", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "+ Start Test" })).toHaveCount(0);
  await mobile(page, "corporate-workspace");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PRE-AI materials" }).click();
  expect((await download).suggestedFilename()).toBe("inbox-pre.zip");
  await page
    .getByLabel("Method notes")
    .fill("Reconciled source records independently.");
  await expect(page.locator(".save-status")).toContainText("All changes saved");
  await page.reload();
  await expect(page.getByLabel("Method notes")).toHaveValue(
    "Reconciled source records independently.",
  );
  await page.route("**/api/rooms/*/save", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Injected storage outage" }),
    }),
  );
  await page
    .getByLabel("Method notes")
    .fill("Recovered after interrupted durable save.");
  await expect(
    page.getByRole("alert").filter({ hasText: "Injected storage outage" }),
  ).toBeVisible();
  await page.unroute("**/api/rooms/*/save");
  await page.getByRole("button", { name: "Retry saving now" }).click();
  await expect(page.locator(".save-status")).toContainText("All changes saved");
  await finish(page, "pre");
  await expect(page.getByText("60 / 60", { exact: true })).toBeVisible();
  expect(
    (await post(page.request, `rooms/${program.preRoomId}/join`, {})).status(),
  ).toBe(409);
  expect(
    (
      await post(page.request, `rooms/${program.preRoomId}/submit`, {})
    ).status(),
  ).toBe(200);
  await grade(hp, program.preRoomId, initial.identity.id);
  await page.reload();
  await expect(page.getByText("100 / 100", { exact: true })).toBeVisible();
  await page.goto("/attendee/join?code=" + program.postRoomId);
  await page.getByRole("button", { name: "Validate room" }).click();
  await expect(page.locator(".error")).toContainText("closed");
  await hp.goto("/host/assessments/" + program.id);
  await hp.getByRole("button", { name: "Open room", exact: true }).click();
  await expect(
    hp.getByRole("button", { name: "Open room", exact: true }),
  ).toHaveCount(0);
  await join(page, program.postRoomId);
  await expect(page.getByRole("tab")).toHaveCount(5);
  const postAttempt: Participant = (
    await (await page.request.get("/api/rooms/" + program.postRoomId)).json()
  ).participant;
  expect(postAttempt.selected).toEqual(tasks);
  await finish(page, "post");
  expect(
    (
      await (
        await hp.request.get(`/api/rooms/${program.postRoomId}/comparisons`)
      ).json()
    ).pairs[0].comparable,
  ).toBe(false);
  await grade(hp, program.postRoomId, initial.identity.id);
  await page.goto("/attendee/results");
  await expect(
    page.getByRole("heading", { name: "Progress you can see." }),
  ).toBeVisible();
  await expect(page.locator(".comparison-charts figure")).toHaveCount(4);
  // The scorecard's Pre/Post area shows the genuine matched marks.
  await expect(page.locator(".sc-pp-figures dd").nth(0)).toContainText("/ 100");
  await expect(page.locator(".sc-pp-figures dd").nth(1)).toContainText("/ 100");
  await expect(page.locator(".sc-pp-figures")).not.toContainText(
    "Not available",
  );
  await hp.goto(`/host/rooms/${program.postRoomId}/monitor`);
  await expect(
    hp.getByRole("cell", { name: "Finalized", exact: true }),
  ).toBeVisible();
  await mobile(hp, "corporate-monitor");
  await hp.goto("/host/reports");
  await hp.getByLabel("Company / cohort filter").fill("Acceptance Finance");
  await expect(
    hp.getByRole("heading", { name: "Modeled financial ROI" }),
  ).toBeVisible();
  await hp.goto("/host/reports/export");
  await hp.getByLabel("Assessment round").selectOption(program.postRoomId);
  const report = hp.waitForEvent("download");
  await hp.getByRole("button", { name: "Download Excel report" }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await readFile((await (await report).path())!)) as never);
  expect(wb.getWorksheet("Participants")!.getCell("T2").value).toBe(
    "corporate-all5-v2",
  );
  expect(wb.getWorksheet("Participants")!.getCell("U2").value).toBe(100);
  const zip = hp.waitForEvent("download");
  await hp.getByRole("button", { name: "Download evidence ZIP" }).click();
  const archive = await JSZip.loadAsync(
    await readFile((await (await zip).path())!),
  );
  expect(
    JSON.parse(await archive.file("manifest.json")!.async("string")).files,
  ).toHaveLength(5);
  expect(errors).toEqual([]);
  await hc.close();
});
test("local password identities retain private access to ordinary portals without developer controls", async ({
  page,
}) => {
  for (const id of ["DEMO001", "HOST001"] as const) {
    await page.goto("/login");
    await page.getByLabel("Email or User ID").fill(id);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByLabel("Password", { exact: true })
      .fill("incorrect-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".error")).toContainText(
      "Check your credentials",
    );
    await page
      .getByLabel("Password", { exact: true })
      .fill(
        id === "DEMO001"
          ? process.env.E2E_ATTENDEE_PASSWORD!
          : process.env.E2E_HOST_PASSWORD!,
      );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(id === "DEMO001" ? "/attendee" : "/host");
    expect(await page.locator("body").innerText()).not.toMatch(
      /Page Explorer|Developer Preview|Reset Demo Data|Enter as Demo/,
    );
    await mobile(page, "corporate-" + id);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");
  }
});
