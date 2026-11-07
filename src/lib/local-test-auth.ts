import { scrypt, timingSafeEqual } from "node:crypto";
import { AppError, type Identity } from "./types";
import { required } from "./config";
import { mutate, type Storage } from "./storage";
import { assertLocalTestEnabled, testGeneration } from "./local-test-storage";
import { ensureTestData, testHost, testAttendee } from "./local-test-data";
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
type Attempts = { window: number; count: number };
export async function authenticateLocalTest(
  base: Storage,
  userId: "DEMO001" | "HOST001",
  password: string,
): Promise<Identity> {
  assertLocalTestEnabled();
  const configured = required(
    userId === "DEMO001" ? "TEST_ATTENDEE_PASSWORD" : "TEST_HOST_PASSWORD",
  );
  if (configured.length < 12 || configured.length > 256)
    throw new AppError(
      503,
      "Sign-in is unavailable. Contact your administrator.",
    );
  const key = `auth/test-attempts/${userId}.json`;
  await mutate<Attempts>(base, key, (old) => {
    const now = Date.now(),
      entry =
        old && old.window + 15 * 60000 > now ? old : { window: now, count: 0 };
    if (entry.count >= 5)
      throw new AppError(
        429,
        "Too many sign-in attempts. Try again in 15 minutes.",
      );
    return { ...entry, count: entry.count + 1 };
  });
  const salt = "technoedge-local-account-" + userId;
  const [given, expected] = await Promise.all([
    derive(password, salt),
    derive(configured, salt),
  ]);
  if (!timingSafeEqual(given, expected))
    throw new AppError(401, "Unable to sign in. Check your credentials.");
  await mutate<Attempts>(base, key, () => ({ window: Date.now(), count: 0 }));
  const generation = await testGeneration(base);
  await ensureTestData(base, generation);
  return {
    ...(userId === "DEMO001" ? testAttendee : testHost),
    testGeneration: generation,
  };
}
