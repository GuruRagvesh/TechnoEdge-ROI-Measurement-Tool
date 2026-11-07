// Operator-only local visual review. Uses the ordinary private credential flow;
// creates one synthetic assessment in the isolated HOST001/DEMO001 store.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
process.loadEnvFile(".env.local");
const origin = "http://127.0.0.1:3000";
if (
  process.env.STORAGE_ADAPTER !== "local" ||
  process.env.LOCAL_TEST_ACCOUNTS !== "true" ||
  process.env.NODE_ENV === "production" ||
  process.env.APP_URL !== origin
)
  throw new Error(
    "Visual review requires the existing loopback local test environment",
  );
const folder = resolve("../final-review/screenshots");
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
async function login(id, key) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    baseURL: origin,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByLabel("Email or User ID").fill(id);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(process.env[key]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(id === "HOST001" ? "/host" : "/attendee");
  return { context, page };
}
const screens = [];
async function shot(page, file, title, path) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.screenshot({
    path: resolve(folder, file + ".png"),
    fullPage: true,
  });
  screens.push({ file, title, path });
}
try {
  const publicContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    baseURL: origin,
  });
  const publicPage = await publicContext.newPage();
  await shot(publicPage, "public-landing", "Public landing page", "/");
  await shot(
    publicPage,
    "public-login",
    "Login — email OTP or private local account",
    "/login",
  );
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await shot(publicPage, "public-login-mobile", "Mobile login", "/login");
  await publicContext.close();
  const h = await login("HOST001", "TEST_HOST_PASSWORD");
  const created = await h.page.request.post("/api/programs", {
    headers: { Origin: origin },
    data: {
      company: "TechnoEdge Learning Services",
      cohort: "Internal visual review — 7 November 2026",
      requestId: randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const { program } = await created.json();
  await shot(h.page, "host-dashboard", "Host dashboard", "/host");
  await shot(
    h.page,
    "host-create",
    "Create assessment",
    "/host/assessments/new",
  );
  await shot(
    h.page,
    "host-manage",
    "Paired room management",
    "/host/assessments/" + program.id,
  );
  const rooms = (await (await h.page.request.get("/api/rooms")).json()).rooms;
  let evaluation;
  for (const room of rooms) {
    const response = await h.page.request.get(
      `/api/rooms/${room.id}/participants`,
    );
    const data = await response.json();
    const person = data.participants?.find(
      (p) => p.submittedAt && p.selected.length === 3,
    );
    if (person) {
      evaluation = { room, person };
      break;
    }
  }
  if (evaluation) {
    await shot(
      h.page,
      "host-monitor",
      "Live monitoring and participants",
      `/host/rooms/${evaluation.room.id}/monitor`,
    );
    await shot(
      h.page,
      "host-evaluate",
      "Practical evaluation",
      `/host/rooms/${evaluation.room.id}/evaluate/${evaluation.person.identity.id}`,
    );
  }
  await shot(
    h.page,
    "host-analytics",
    "Observed outcomes and modeled ROI",
    "/host/reports",
  );
  await shot(
    h.page,
    "host-export",
    "Excel and evidence exports",
    "/host/reports/export",
  );
  await h.page.setViewportSize({ width: 390, height: 844 });
  await shot(
    h.page,
    "host-create-mobile",
    "Mobile assessment creation",
    "/host/assessments/new",
  );
  expect(
    await h.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await h.page.setViewportSize({ width: 1440, height: 1000 });
  const a = await login("DEMO001", "TEST_ATTENDEE_PASSWORD");
  const entries = (await (await a.page.request.get("/api/dashboard")).json())
    .entries;
  const pair = entries.find(
    (e) =>
      e.room.programId && e.room.phase === "post" && e.participant?.submittedAt,
  );
  await shot(a.page, "attendee-dashboard", "Personal dashboard", "/attendee");
  await shot(
    a.page,
    "attendee-assessments",
    "Base Camp and Summit availability",
    "/attendee/assessments",
  );
  await shot(
    a.page,
    "attendee-join",
    "Room entry and confirmed join",
    "/attendee/join",
  );
  if (pair)
    await shot(
      a.page,
      "attendee-comparison",
      "Pre/Post comparison",
      `/attendee/results/${pair.room.programId}/comparison`,
    );
  async function joinAndSelect(room, tasks) {
    await a.page.goto("/attendee/join?code=" + room);
    await a.page.getByLabel("Room code").fill(room);
    await a.page
      .getByRole("button", { name: "Validate room", exact: true })
      .click();
    await expect(
      a.page.getByRole("button", { name: "Enter room and start timer" }),
    ).toBeVisible();
    if (!screens.some((s) => s.file === "attendee-room-confirmation")) {
      await a.page.screenshot({
        path: resolve(folder, "attendee-room-confirmation.png"),
        fullPage: true,
      });
      screens.push({
        file: "attendee-room-confirmation",
        title: "Validated room and explicit timer confirmation",
        path: "/attendee/join?code=" + room,
      });
    }
    await a.page
      .getByRole("button", { name: "Enter room and start timer" })
      .click();
    for (const title of tasks)
      await a.page.getByRole("button", { name: new RegExp(title) }).click();
    await a.page
      .getByRole("button", { name: "Confirm selected challenges" })
      .click();
    await expect(a.page.getByRole("tab").first()).toBeVisible();
  }
  const titles = [
    "Inbox Inferno",
    "The Hundred-Table Puzzle",
    "The Dirty Data Disaster",
  ];
  await joinAndSelect(program.preRoomId, titles);
  for (let t = 0; t < titles.length; t++) {
    await a.page.getByRole("tab", { name: new RegExp(titles[t]) }).click();
    const file = ["inbox", "tables", "clean"][t];
    await a.page.screenshot({
      path: resolve(folder, "challenge-" + file + ".png"),
      fullPage: true,
    });
    screens.push({
      file: "challenge-" + file,
      title: titles[t] + " — actual timed workspace",
      path: "/attendee/rooms/" + program.preRoomId,
    });
    for (let i = 0; i < 4; i++)
      await a.page
        .getByRole("radio")
        .nth(i * 4)
        .check();
    await a.page
      .getByLabel("Method notes")
      .fill(
        "Synthetic visual walkthrough. Demonstrates the ordinary answer, evidence and submission flow.",
      );
    await expect(a.page.locator(".save-status")).toContainText(
      "All changes saved",
    );
    await a.page
      .getByLabel("Upload evidence")
      .setInputFiles({
        name: file + "-synthetic-result.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Classification,Result\nSynthetic walkthrough,100"),
      });
    await expect(
      a.page
        .locator(".evidence-file")
        .filter({ hasText: file + "-synthetic-result.csv" }),
    ).toBeVisible();
    await a.page.getByLabel("Mark this challenge complete").check();
    await expect(a.page.locator(".save-status")).toContainText(
      "All changes saved",
    );
  }
  await a.page
    .getByRole("button", { name: "Submit assessment", exact: true })
    .click();
  await expect(
    a.page.getByRole("heading", { name: "Review before submission" }),
  ).toBeVisible();
  await a.page.screenshot({
    path: resolve(folder, "attendee-submission-review.png"),
    fullPage: true,
  });
  screens.push({
    file: "attendee-submission-review",
    title: "Submission review — three completed challenges",
    path: new URL(a.page.url()).pathname,
  });
  await a.page
    .getByRole("button", { name: "Submit & lock assessment" })
    .click();
  await expect(
    a.page.getByRole("heading", { name: "Submission received" }),
  ).toBeVisible();
  await a.page.screenshot({
    path: resolve(folder, "attendee-submission-receipt.png"),
    fullPage: true,
  });
  screens.push({
    file: "attendee-submission-receipt",
    title: "Durable submission receipt and locked attempt",
    path: new URL(a.page.url()).pathname,
  });
  const participant = (
    await (await a.page.request.get("/api/rooms/" + program.preRoomId)).json()
  ).participant;
  await shot(
    h.page,
    "host-current-grading",
    "Grading the submitted walkthrough attempt",
    `/host/rooms/${program.preRoomId}/evaluate/${participant.identity.id}`,
  );
  for (const task of ["inbox", "tables", "clean"]) {
    await h.page.getByLabel("Challenge", { exact: true }).selectOption(task);
    await h.page.getByLabel("completeness /3").fill("3");
    await h.page.getByLabel("accuracy /3").fill("3");
    await h.page.getByLabel("Presentation /2").fill("2");
    await h.page
      .getByLabel("Evaluator feedback")
      .fill(
        "Synthetic local visual walkthrough only; these are illustrative practical marks.",
      );
    const saved = h.page.waitForResponse(
      (r) => r.url().endsWith("/grade") && r.request().method() === "POST",
    );
    await h.page
      .getByRole("button", { name: "Save practical evaluation" })
      .click();
    expect((await saved).status()).toBe(200);
    await expect(
      h.page.getByRole("button", { name: "Save practical evaluation" }),
    ).toBeEnabled();
  }
  await shot(
    a.page,
    "attendee-personal-results",
    "Personal results after practical evaluation",
    "/attendee/rooms/" + program.preRoomId,
  );
  const second = await h.page.request.post("/api/programs", {
    headers: { Origin: origin },
    data: {
      company: "TechnoEdge Learning Services",
      cohort: "Remaining challenge workspaces — 7 November 2026",
      requestId: randomUUID(),
    },
  });
  expect(second.status()).toBe(201);
  const secondProgram = (await second.json()).program;
  await joinAndSelect(secondProgram.preRoomId, [
    "The Boardroom Dashboard",
    "The MBR Deadline",
    "Inbox Inferno",
  ]);
  for (const [file, title] of [
    ["dashboard", "The Boardroom Dashboard"],
    ["mbr", "The MBR Deadline"],
  ]) {
    await a.page.getByRole("tab", { name: new RegExp(title) }).click();
    await a.page.screenshot({
      path: resolve(folder, "challenge-" + file + ".png"),
      fullPage: true,
    });
    screens.push({
      file: "challenge-" + file,
      title: title + " — actual timed workspace",
      path: "/attendee/rooms/" + secondProgram.preRoomId,
    });
  }
  await shot(
    a.page,
    "attendee-workspace",
    "Timed assessment and evidence workspace",
    `/attendee/rooms/${secondProgram.preRoomId}`,
  );
  await a.page.setViewportSize({ width: 390, height: 844 });
  expect(
    await a.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await a.page.screenshot({
    path: resolve(folder, "attendee-mobile.png"),
    fullPage: true,
  });
  screens.push({
    file: "attendee-mobile",
    title: "390px mobile assessment workspace",
    path: "/attendee/rooms/" + secondProgram.preRoomId,
  });
  expect(errors).toEqual([]);
  await writeFile(
    resolve(folder, "index.json"),
    JSON.stringify(
      { captured: "2026-11-07", dataClassification: "synthetic-test", screens },
      null,
      2,
    ),
  );
  console.log(
    `Captured ${screens.length} actual application views, including all five challenges, submission, grading, results and mobile; no page errors. Only isolated synthetic local records were created.`,
  );
} finally {
  await browser.close();
}
