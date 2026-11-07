import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import {
  localTestAccountsEnabled,
  localTestRequestAllowed,
} from "../src/lib/config";
import {
  testGeneration,
  resetTestGeneration,
  LocalTestStorage,
} from "../src/lib/local-test-storage";
import { authenticateLocalTest } from "../src/lib/local-test-auth";
import { ensureTestData, testHost } from "../src/lib/local-test-data";
import {
  AssessmentService,
  comparison,
  metrics,
  participantKey,
} from "../src/lib/assessment";
import { getJson, mutate } from "../src/lib/storage";
import { excelReport } from "../src/lib/reports";
import { POST } from "../src/app/api/[...path]/route";
import { MemoryStorage } from "./helpers";
import type { Participant } from "../src/lib/types";
describe("local credential accounts and isolated ordinary workflows", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("LOCAL_TEST_ACCOUNTS", "true");
    vi.stubEnv("STORAGE_ADAPTER", "local");
    vi.stubEnv("TEST_ATTENDEE_PASSWORD", "unit-attendee-password-long");
    vi.stubEnv("TEST_HOST_PASSWORD", "unit-host-password-long");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("requires a loopback origin and accepts Next internal localhost normalization", () => {
    expect(localTestAccountsEnabled()).toBe(true);
    expect(
      localTestRequestAllowed(
        new URL("http://localhost:3000/api/auth/test-login"),
        "127.0.0.1:3000",
      ),
    ).toBe(true);
    expect(
      localTestRequestAllowed(
        new URL("https://attacker.test/api/auth/test-login"),
        "127.0.0.1:3000",
      ),
    ).toBe(false);
    expect(
      localTestRequestAllowed(
        new URL("http://localhost:3000/api/auth/test-login"),
        "attacker.test",
      ),
    ).toBe(false);
  });
  it.each([
    ["NODE_ENV", "production"],
    ["NODE_ENV", "test"],
    ["LOCAL_TEST_ACCOUNTS", "false"],
    ["STORAGE_ADAPTER", "graph"],
    ["APP_URL", "https://example.com"],
    ["APP_URL", "http://192.168.1.1:3000"],
  ])("rejects %s=%s even with passwords configured", (key, value) => {
    vi.stubEnv(key, value);
    expect(localTestAccountsEnabled()).toBe(false);
    expect(
      () => new LocalTestStorage(new MemoryStorage(), "a".repeat(36)),
    ).toThrow("Not found");
  });
  it("returns 404 for credential login in production and all obsolete bypass endpoints", async () => {
    for (const env of ["development", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      const paths =
        env === "production"
          ? [
              "auth/test-login",
              "preview/login",
              "preview/reset",
              "auth/development-host",
            ]
          : ["preview/login", "preview/reset", "auth/development-host"];
      for (const path of paths) {
        const r = await POST(
          new NextRequest("http://127.0.0.1:3000/api/" + path, {
            method: "POST",
            headers: {
              Host: "127.0.0.1:3000",
              Origin: "http://127.0.0.1:3000",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId: "HOST001",
              password: "unit-host-password-long",
            }),
          }),
        );
        expect(r.status).toBe(404);
      }
    }
  });
  it("validates both passwords on the server and does not return credential material", async () => {
    const s = new MemoryStorage();
    await expect(authenticateLocalTest(s, "DEMO001", "wrong")).rejects.toThrow(
      "Check your credentials",
    );
    const a = await authenticateLocalTest(
        s,
        "DEMO001",
        "unit-attendee-password-long",
      ),
      h = await authenticateLocalTest(s, "HOST001", "unit-host-password-long");
    expect(a).toMatchObject({
      id: "DEMO001",
      name: "Arjun Mehta",
      role: "attendee",
      testAccount: true,
    });
    expect(h).toMatchObject({
      id: "HOST001",
      name: "Priya Sharma",
      role: "host",
      testAccount: true,
    });
    expect(JSON.stringify([a, h, ...s.files.values()])).not.toContain(
      "unit-host-password-long",
    );
  });
  it("bounds failed password attempts and rejects missing/weak configuration", async () => {
    const s = new MemoryStorage();
    for (let i = 0; i < 5; i++)
      await expect(
        authenticateLocalTest(s, "HOST001", "wrong"),
      ).rejects.toThrow("Check your credentials");
    await expect(
      authenticateLocalTest(s, "HOST001", "unit-host-password-long"),
    ).rejects.toThrow("Too many");
    vi.stubEnv("TEST_ATTENDEE_PASSWORD", "short");
    await expect(authenticateLocalTest(s, "DEMO001", "short")).rejects.toThrow(
      "unavailable",
    );
  });
  it("seeds realistic history and fresh assessments without progression shortcuts", async () => {
    const base = new MemoryStorage(),
      s = await ensureTestData(base, await testGeneration(base)),
      service = new AssessmentService(s);
    const pre = (await service.participant("baseline-pre", "DEMO001"))!,
      post = (await service.participant("baseline-post", "DEMO001"))!;
    expect(pre.identity.name).toBe("Arjun Mehta");
    expect(metrics(pre).minutes).toBe(45);
    expect(metrics(post).minutes).toBe(28);
    expect(comparison(pre, post)).toMatchObject({
      comparable: true,
      minutesSaved: 17,
    });
    expect(
      await service.participant("ai-productivity-pre", "DEMO001"),
    ).toBeNull();
    await expect(service.join("summit-next", pre.identity)).rejects.toThrow(
      "Base Camp",
    );
    await service.join("ai-productivity-pre", pre.identity);
    await expect(
      service.submit("ai-productivity-pre", "DEMO001"),
    ).rejects.toThrow("Complete all three");
    expect((await service.room("baseline-pre")).dataClassification).toBe(
      "synthetic-test",
    );
    expect(
      (await s.read(pre.evidence[0].path))!.data.subarray(0, 2).toString(),
    ).toBe("PK");
  });
  it("reset preserves real records and restores only the isolated sample data", async () => {
    const base = new MemoryStorage();
    await base.write(
      "rooms/real/record.json",
      Buffer.from('{"real":true}'),
      null,
    );
    const first = await testGeneration(base),
      old = await ensureTestData(base, first);
    await mutate<Participant>(
      old,
      participantKey("baseline-pre", "DEMO001"),
      (p) => ({ ...p!, notes: { inbox: "edited" } }),
    );
    const fresh = await ensureTestData(base, await resetTestGeneration(base));
    expect(
      (await getJson<Participant>(
        fresh,
        participantKey("baseline-pre", "DEMO001"),
      ))!.notes.inbox,
    ).not.toBe("edited");
    expect((await base.read("rooms/real/record.json"))!.data.toString()).toBe(
      '{"real":true}',
    );
  });
  it("identifies synthetic records in exports without developer labels in displayed records", async () => {
    const base = new MemoryStorage(),
      s = await ensureTestData(base, await testGeneration(base)),
      service = new AssessmentService(s),
      room = await service.room("baseline-post");
    const p = (await service.participant("baseline-post", "DEMO001"))!;
    expect(
      [
        p.identity.name,
        ...Object.values(p.notes),
        ...Object.values(p.grades).map((g) => g.feedback),
      ].join(" "),
    ).not.toMatch(/demo|preview|synthetic/i);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await excelReport(service, room, testHost)) as unknown as Parameters<
        typeof wb.xlsx.load
      >[0],
    );
    expect(
      JSON.stringify(wb.getWorksheet("Read me")!.getSheetValues()),
    ).toContain("synthetic-test");
    expect(wb.getWorksheet("Participants")!.getCell("S2").value).toBe(
      "synthetic-test",
    );
  });
});
