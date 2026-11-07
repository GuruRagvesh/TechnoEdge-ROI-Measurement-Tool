import { getJson, type Storage } from "./storage";
// No public endpoint can modify this registry. Provision with the trusted administration CLI.
export async function authorizedRole(
  store: Storage,
  email: string,
): Promise<"host" | "attendee"> {
  const registry = await getJson<{ emails: string[] }>(
    store,
    "config/host-allowlist.json",
  );
  const normalized = email.trim().toLowerCase();
  return normalized &&
    registry?.emails.some((e) => e.trim().toLowerCase() === normalized)
    ? "host"
    : "attendee";
}
