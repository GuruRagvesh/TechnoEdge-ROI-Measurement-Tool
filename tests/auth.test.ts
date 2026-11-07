import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage, attendee } from "./helpers";
const state = vi.hoisted(() => ({
  store: null as unknown as MemoryStorage,
  jar: new Map<string, string>(),
  claims: {
    tid: "tenant-id",
    oid: "object-id",
    name: "Company Host",
    preferred_username: "host@company.test",
    roles: ["Assessment.Host"],
  } as Record<string, unknown>,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) =>
      state.jar.has(key) ? { value: state.jar.get(key) } : undefined,
    set: (key: string, value: string) => state.jar.set(key, value),
    delete: (key: string) => state.jar.delete(key),
  }),
}));
vi.mock("../src/lib/storage", async (original) => ({
  ...(await original<typeof import("../src/lib/storage")>()),
  storage: () => state.store,
}));
vi.mock("openid-client", () => ({
  discovery: vi.fn(async () => ({})),
  randomPKCECodeVerifier: () => "test-pkce-verifier",
  calculatePKCECodeChallenge: async () => "test-pkce-challenge",
  buildAuthorizationUrl: (_config: unknown, params: Record<string, string>) =>
    new URL(
      "https://login.microsoftonline.com/authorize?" +
        new URLSearchParams(params),
    ),
  authorizationCodeGrant: vi.fn(async () => ({ claims: () => state.claims })),
}));
import {
  createSession,
  logout,
  requestCode,
  requireIdentity,
  session,
  verifyCode,
} from "../src/lib/auth";
import { stableId } from "../src/lib/identity";
import { mockAuth, validateConfig } from "../src/lib/config";
import {
  testGeneration,
  resetTestGeneration,
} from "../src/lib/local-test-storage";
describe("authentication and fail-closed configuration", () => {
  beforeEach(() => {
    state.store = new MemoryStorage();
    state.jar.clear();
    state.claims = {
      tid: "tenant-id",
      oid: "object-id",
      name: "Company Host",
      preferred_username: "host@company.test",
      roles: ["Assessment.Host"],
    };
    vi.stubEnv("MOCK_AUTH", "true");
    vi.stubEnv("STORAGE_ADAPTER", "local");
    vi.stubEnv(
      "IDENTITY_PEPPER",
      "test-only-identity-pepper-longer-than-32-characters",
    );
    vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("GRAPH_TENANT_ID", "tenant-id");
    vi.stubEnv("ENTRA_CLIENT_ID", "client-id");
    vi.stubEnv("ENTRA_CLIENT_SECRET", "server-only-secret");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects demo sessions after reset or after preview is disabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_TEST_ACCOUNTS", "true");
    const generation = await testGeneration(state.store);
    await createSession({
      ...attendee,
      id: "DEMO001",
      testAccount: true,
      testGeneration: generation,
    });
    expect((await session())?.id).toBe("DEMO001");
    await resetTestGeneration(state.store);
    expect(await session()).toBeNull();
    await createSession({
      ...attendee,
      id: "DEMO001",
      testAccount: true,
      testGeneration: await testGeneration(state.store),
    });
    vi.stubEnv("NODE_ENV", "production");
    expect(await session()).toBeNull();
  });
  it("stores only hashed session tokens and revokes logout durably", async () => {
    await createSession(attendee);
    const raw = state.jar.get("te_session")!;
    expect(raw.length).toBeGreaterThan(40);
    expect([...state.store.files.keys()].some((x) => x.includes(raw))).toBe(
      false,
    );
    expect(await session()).toEqual(attendee);
    await expect(requireIdentity("host")).rejects.toThrow("access");
    await logout();
    expect(await session()).toBeNull();
    state.jar.set("te_session", raw);
    expect(await session()).toBeNull();
  });
  it("verifies attendee codes once and keeps stable identity across case-normalized email", async () => {
    const issued = await requestCode("First Name", "Person@Example.Test");
    const mail = JSON.parse(
      state.store.files
        .get(`dev-mail/${issued.challengeId}.json`)!
        .data.toString(),
    );
    const identity = await verifyCode(issued.challengeId, mail.code);
    expect(identity.id).toBe(stableId("person@example.test"));
    expect(identity.email).toBe("person@example.test");
    await expect(verifyCode(issued.challengeId, mail.code)).rejects.toThrow(
      "already used",
    );
    await expect(requestCode("Again", "person@example.test")).rejects.toThrow(
      "Too many",
    );
  });
  it("assigns host only after OTP verification using the server registry and revokes on registry removal", async () => {
    const { mutate } = await import("../src/lib/storage");
    await mutate(state.store, "config/host-allowlist.json", () => ({
      emails: ["reviewer@technoedge.test"],
    }));
    const x = await requestCode("Reviewer", "Reviewer@TechnoEdge.Test");
    const mail = JSON.parse(
      state.store.files
        .get("dev-mail/" + x.challengeId + ".json")!
        .data.toString(),
    );
    await expect(verifyCode(x.challengeId, "000000")).rejects.toThrow(
      "Incorrect",
    );
    expect(await session()).toBeNull();
    expect((await verifyCode(x.challengeId, mail.code)).role).toBe("host");
    expect((await requireIdentity("host")).email).toBe(
      "reviewer@technoedge.test",
    );
    await mutate(state.store, "config/host-allowlist.json", () => ({
      emails: [],
    }));
    await expect(requireIdentity("host")).rejects.toThrow("access");
    expect((await session())?.role).toBe("attendee");
  });
  it.each(["other@technoedge.test", "person@gmail.com", "person@outlook.com"])(
    "never grants host based on domain or supplied name: %s",
    async (email) => {
      const { mutate } = await import("../src/lib/storage");
      await mutate(state.store, "config/host-allowlist.json", () => ({
        emails: ["reviewer@technoedge.test"],
      }));
      const x = await requestCode("TechnoEdge Host", email);
      const mail = JSON.parse(
        state.store.files
          .get("dev-mail/" + x.challengeId + ".json")!
          .data.toString(),
      );
      expect((await verifyCode(x.challengeId, mail.code)).role).toBe(
        "attendee",
      );
    },
  );
  it("disables mock auth in production and rejects a local storage production deployment", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(mockAuth()).toBe(false);
    expect(() => validateConfig()).toThrow("Production requires");
  });
  it("bounds code requests across addresses sharing a source", async () => {
    vi.stubEnv("OTP_IP_HOURLY_LIMIT", "1");
    await requestCode("Person One", "one@example.test", "192.0.2.1");
    await expect(
      requestCode("Person Two", "two@example.test", "192.0.2.1"),
    ).rejects.toThrow("Too many");
    await expect(
      requestCode("Person Two", "two@example.test", "192.0.2.2"),
    ).resolves.toHaveProperty("challengeId");
  });
});
