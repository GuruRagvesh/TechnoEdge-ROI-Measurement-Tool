import { createHash, randomBytes, randomInt } from "node:crypto";
import { sendVerificationEmail } from "./mail";
import { cookies } from "next/headers";
import { AppError, type Identity } from "./types";
import { appUrl, localTestAccountsEnabled, mockAuth, required } from "./config";
import { testGeneration } from "./local-test-storage";
import { createJson, getJson, mutate, storage } from "./storage";
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
import { authorizedRole } from "./host-registry";
import { stableId } from "./identity";
export { stableId } from "./identity";
const nonce = () => randomBytes(32).toString("base64url");
const cookieOptions = () => ({
  httpOnly: true,
  secure: appUrl().protocol === "https:",
  sameSite: "lax" as const,
  path: "/",
});
type Session = { identity: Identity; expires: number; revoked: boolean };
// Sessions only change when they are revoked, so each server instance keeps a
// copy for up to 30 s instead of reading SharePoint on every request. Logout
// clears it on this instance; other instances honour a logged-out token for
// at most 30 s. Roles are not cached here (see host-registry).
const SESSION_TTL_MS = 30_000;
const sessionCache = new WeakMap<
  object,
  Map<string, { s: Session | null; until: number }>
>();
function sessionsFor(store: object) {
  let m = sessionCache.get(store);
  if (!m) sessionCache.set(store, (m = new Map()));
  return m;
}
async function readSession(key: string) {
  const store = storage(),
    cache = sessionsFor(store),
    now = Date.now(),
    hit = cache.get(key);
  if (hit && hit.until > now) return hit.s;
  const s = await getJson<Session>(store, key);
  if (cache.size > 20000) cache.clear();
  cache.set(key, { s, until: now + SESSION_TTL_MS });
  return s;
}
export async function session() {
  const token = (await cookies()).get("te_session")?.value;
  if (!token) return null;
  const s = await readSession(`auth/sessions/${digest(token)}.json`);
  if (!s || s.revoked || s.expires <= Date.now()) return null;
  if (
    s.identity.preview ||
    s.identity.developmentOnly ||
    s.identity.id === "development-host"
  )
    return null;
  if (s.identity.testAccount) {
    if (
      !localTestAccountsEnabled() ||
      !["DEMO001", "HOST001"].includes(s.identity.id) ||
      s.identity.testGeneration !== (await testGeneration(storage()))
    )
      return null;
  } else if (["DEMO001", "HOST001"].includes(s.identity.id)) return null;
  return s.identity.testAccount
    ? s.identity
    : {
        ...s.identity,
        role: await authorizedRole(storage(), s.identity.email),
      };
}
export async function requireIdentity(role?: Identity["role"]) {
  const identity = await session();
  if (!identity) throw new AppError(401, "Please sign in to continue.");
  if (role && identity.role !== role)
    throw new AppError(403, "You do not have access to this portal.");
  return identity;
}
export async function createSession(identity: Identity) {
  const token = nonce();
  await createJson(storage(), `auth/sessions/${digest(token)}.json`, {
    identity,
    expires: Date.now() + 12 * 3600000,
    revoked: false,
  });
  (await cookies()).set("te_session", token, {
    ...cookieOptions(),
    maxAge: 12 * 3600,
  });
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get("te_session")?.value;
  if (token) {
    const key = `auth/sessions/${digest(token)}.json`;
    sessionsFor(storage()).delete(key);
    await mutate<Session>(storage(), key, (s) => {
      if (!s) throw new AppError(401, "Session expired");
      return { ...s, revoked: true };
    });
    sessionsFor(storage()).delete(key);
  }
  jar.delete("te_session");
}
type Rate = { window: number; count: number; last: number };
async function rate(key: string, max: number, cooldown: number) {
  await mutate<Rate>(storage(), `auth/rates/${key}.json`, (old) => {
    const now = Date.now();
    const r =
      old && old.window + 3600000 > now
        ? old
        : { window: now, count: 0, last: 0 };
    if (r.count >= max || now - r.last < cooldown)
      throw new AppError(
        429,
        "Too many verification requests. Please wait before trying again.",
      );
    return { ...r, count: r.count + 1, last: now };
  });
}
type Challenge = {
  id: string;
  email: string;
  name: string;
  hash: string;
  expires: number;
  attempts: number;
  consumed: boolean;
};
export async function requestCode(
  name: string,
  email: string,
  source?: string,
) {
  email = email.trim().toLowerCase();
  if (source)
    await rate(
      "source-" + digest(source),
      Number(process.env.OTP_IP_HOURLY_LIMIT || 180),
      0,
    );
  await rate(stableId(email), 6, 30000);
  await rate("global", Number(process.env.EMAIL_HOURLY_LIMIT || 200), 0);
  const id = nonce(),
    code = String(randomInt(100000, 1000000));
  const record: Challenge = {
    id,
    email,
    name,
    hash: stableId(id + code),
    expires: Date.now() + 10 * 60000,
    attempts: 0,
    consumed: false,
  };
  await createJson(storage(), `auth/challenges/${id}.json`, record);
  if (mockAuth())
    await createJson(storage(), `dev-mail/${id}.json`, {
      email,
      code,
      createdAt: new Date().toISOString(),
    });
  else await sendVerificationEmail(email, code, id);
  return { challengeId: id, development: mockAuth() };
}
export async function verifyCode(id: string, code: string) {
  let verified = false;
  const record = await mutate<Challenge>(
    storage(),
    `auth/challenges/${id}.json`,
    (old) => {
      verified = false;
      if (!old || old.consumed || old.expires < Date.now() || old.attempts >= 5)
        throw new AppError(
          400,
          "Code expired or already used. Request a new code.",
        );
      verified = old.hash === stableId(id + code);
      return { ...old, attempts: old.attempts + 1, consumed: verified };
    },
  );
  if (!verified) throw new AppError(400, "Incorrect code. Please try again.");
  const identity: Identity = {
    id: stableId(record.email),
    email: record.email,
    name: record.name,
    role: await authorizedRole(storage(), record.email),
  };
  // Registration record: created once, then only the name and login times change.
  const now = new Date().toISOString();
  await mutate<
    Identity & { createdAt?: string; verifiedAt?: string; lastLoginAt?: string }
  >(storage(), `identities/${identity.id}.json`, (old) => ({
    ...identity,
    createdAt: old?.createdAt || now,
    verifiedAt: old?.verifiedAt || now,
    lastLoginAt: now,
  }));
  await createSession(identity);
  return identity;
}
