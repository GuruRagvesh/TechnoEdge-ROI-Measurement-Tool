import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { regularHostContext } from "./auth-helpers";
const origin = "http://127.0.0.1:3100";
async function signIn(
  page: Page,
  id: "DEMO001" | "HOST001",
  password?: string,
) {
  await page.goto("/login");
  await page.getByLabel("Email or User ID").fill(id);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Password", { exact: true })
    .fill(
      password ||
        (id === "DEMO001"
          ? process.env.E2E_ATTENDEE_PASSWORD!
          : process.env.E2E_HOST_PASSWORD!),
    );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
test("test accounts are isolated, must follow assessment rules, and reset is CLI-only", async ({
  page,
  browser,
}) => {
  const real = await regularHostContext(browser);
  const created = await real.request.post("/api/programs", {
    headers: { Origin: origin },
    data: {
      company: "Protected real company",
      cohort: "Real records",
      requestId: crypto.randomUUID(),
    },
  });
  const realRoom = { id: (await created.json()).program.preRoomId };
  await real.request.post(`/api/rooms/${realRoom.id}/close`, {
    headers: { Origin: origin },
    data: { closed: true },
  });
  await signIn(page, "HOST001");
  await expect(page).toHaveURL("/host");
  expect(
    (await page.request.get(`/api/rooms/${realRoom.id}/participants`)).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post(`/api/rooms/${realRoom.id}/close`, {
        headers: { Origin: origin },
        data: { closed: false },
      })
    ).status(),
  ).toBe(404);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await signIn(page, "DEMO001");
  await expect(page).toHaveURL("/attendee");
  expect(
    (
      await page.request.post("/api/rooms/summit-next/join", {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(409);
  let r = await page.request.post("/api/rooms/ai-productivity-pre/join", {
    headers: { Origin: origin },
    data: {},
  });
  r = await page.request.post("/api/rooms/ai-productivity-pre/start", {
    headers: { Origin: origin },
    data: { selected: ["dashboard", "mbr", "clean"] },
  });
  expect(r.status()).toBe(200);
  expect(
    (
      await page.request.post("/api/rooms/ai-productivity-pre/submit", {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(400);
  let p = (await r.json()).participant;
  await page.request.post("/api/rooms/ai-productivity-pre/save", {
    headers: { Origin: origin },
    data: {
      revision: p.revision,
      answers: {},
      notes: { dashboard: "Persistent dashboard notes" },
      completed: [],
    },
  });
  await page.goto("/attendee/rooms/ai-productivity-pre");
  await expect(page.getByLabel("Method notes")).toHaveValue(
    "Persistent dashboard notes",
  );
  await page.reload();
  await expect(page.getByLabel("Method notes")).toHaveValue(
    "Persistent dashboard notes",
  );
  const old = await browser.newContext({
    baseURL: origin,
    storageState: await page.context().storageState(),
  });
  const result = execFileSync(
    process.execPath,
    ["scripts/run.mjs", "scripts/reset-test-accounts.ts"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "development",
        APP_URL: origin,
        LOCAL_TEST_ACCOUNTS: "true",
        STORAGE_ADAPTER: "local",
        LOCAL_STORAGE_PATH: ".test-work/e2e",
      },
    },
  );
  expect(result).toContain("Local test records restored");
  expect(
    (await (await old.request.get("/api/auth/me")).json()).identity,
  ).toBeNull();
  const protectedRoom = await (
    await real.request.get(`/api/rooms/${realRoom.id}`)
  ).json();
  expect(protectedRoom.room.closed).toBe(true);
  await old.close();
  await real.close();
});
test("obsolete preview routes and bypasses are unavailable and login has no developer controls on mobile", async ({
  page,
}) => {
  for (const path of [
    "/preview",
    "/preview/attendee/dashboard",
    "/preview/host/analytics",
  ])
    expect((await page.request.get(path)).status()).toBe(404);
  for (const path of [
    "/api/preview/login",
    "/api/preview/reset",
    "/api/auth/development-host",
  ])
    expect(
      (
        await page.request.post(path, {
          headers: { Origin: origin },
          data: { role: "host" },
        })
      ).status(),
    ).toBe(404);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  expect(await page.locator("body").innerText()).not.toMatch(
    /Page Explorer|Developer Preview|Demo Mode|Preview Mode|Reset Demo Data|Enter as Demo|LOCAL DEVELOPMENT/,
  );
  await expect(
    page.getByRole("link", { name: "Sign in with Microsoft" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".test-work/credential-login-mobile.png",
    fullPage: true,
  });
});
