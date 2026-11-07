import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { answerKey } from "../src/lib/challenges";
import type { Participant, TaskId } from "../src/lib/types";
import { regularHostContext } from "./auth-helpers";
const origin = "http://127.0.0.1:3100";
async function post(ctx: APIRequestContext, route: string, data: unknown) {
  return ctx.post("/api/" + route, { headers: { Origin: origin }, data });
}
async function signIn(
  page: Page,
  email = `learner-${Date.now()}@example.test`,
) {
  await page.goto("/login");
  await page.getByLabel("Email or User ID", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Prism Learner");
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
  await expect(page).toHaveURL(/\/attendee$/);
  return email;
}
test("API: authorization, code replay, brute force bounds, CSRF, ownership, deadlines, storage outage", async ({
  page,
  browser,
}) => {
  const anon = await browser.newContext({ baseURL: origin });
  expect((await anon.request.get("/api/rooms")).status()).toBe(401);
  expect(
    (
      await anon.request.post("/api/auth/logout", {
        data: {},
        headers: { Origin: "https://attacker.test" },
      })
    ).status(),
  ).toBe(403);
  const request = await post(anon.request, "auth/request-code", {
    name: "API Attendee",
    email: `api-${Date.now()}@example.test`,
  });
  expect(request.status()).toBe(200);
  const { challengeId } = await request.json();
  const mail = await anon.request.get(
    `/api/auth/development-mail?challenge=${challengeId}`,
  );
  const { code } = await mail.json();
  expect(
    (
      await post(anon.request, "auth/verify-code", { challengeId, code })
    ).status(),
  ).toBe(200);
  expect(
    (
      await post(anon.request, "auth/verify-code", { challengeId, code })
    ).status(),
  ).toBe(400);
  expect(
    (
      await post(anon.request, "rooms", {
        name: "Unauthorized room",
        batch: "Test",
        phase: "pre",
        durationMinutes: 60,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await anon.request.get("/api/rooms/ai-productivity-pre/answer-key")
    ).status(),
  ).toBe(403);
  await post(anon.request, "rooms/ai-productivity-pre/join", {});
  const started = await post(anon.request, "rooms/ai-productivity-pre/start", {
    selected: ["inbox", "tables", "clean"],
  });
  const p: Participant = (await started.json()).participant;
  const filename = path.resolve(
    ".test-work/e2e/rooms/ai-productivity-pre/participants/" +
      p.identity.id +
      ".json",
  );
  const record = JSON.parse(await readFile(filename, "utf8"));
  record.deadline = new Date(Date.now() - 1000).toISOString();
  await writeFile(filename, JSON.stringify(record));
  const late = await post(anon.request, "rooms/ai-productivity-pre/save", {
    revision: p.revision,
    answers: { inbox: [0] },
    notes: {},
    completed: [],
  });
  expect(late.status()).toBe(409);
  expect(
    (await (await anon.request.get("/api/rooms/ai-productivity-pre")).json())
      .participant.submissionReason,
  ).toBe("deadline");
  const wrong = await post(anon.request, "auth/request-code", {
    name: "Wrong Code",
    email: `wrong-${Date.now()}@example.test`,
  });
  const wrongId = (await wrong.json()).challengeId;
  for (let i = 0; i < 5; i++)
    expect(
      (
        await post(anon.request, "auth/verify-code", {
          challengeId: wrongId,
          code: "000000",
        })
      ).status(),
    ).toBe(400);
  const wrongMail = await (
    await anon.request.get(`/api/auth/development-mail?challenge=${wrongId}`)
  ).json();
  expect(
    (
      await post(anon.request, "auth/verify-code", {
        challengeId: wrongId,
        code: wrongMail.code,
      })
    ).status(),
  ).toBe(400);
  await anon.close();
});
