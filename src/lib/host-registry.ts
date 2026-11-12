import type { Storage } from "./storage";
// No public endpoint can modify this registry. Provision with the trusted administration CLI.
//
// Removing a host applies on that person's next request: every "host" answer
// is re-validated. Where the storage can report a file's version cheaply
// (SharePoint: one metadata call), the list is only downloaded when that
// version changes, and "not a host" answers are reused for up to 30 s (so a
// newly added host applies within 30 s). A malformed list never fails
// sign-in: it grants host access to nobody until it is corrected.
const KEY = "config/host-allowlist.json";
type Entry = { emails: Set<string>; version: string; checked: number };
// "Not a host" answers may be reused for 30 s (adding a host applies within
// that window); a "host" answer is re-validated on every request so removal
// applies immediately.
const NOT_HOST_TTL_MS = 30_000;
let cache = new WeakMap<Storage, Entry>();
const normalize = (e: string) => e.trim().toLowerCase();

export function clearHostRegistryCache() {
  cache = new WeakMap();
}

function invalid(reason: string) {
  console.error(
    JSON.stringify({
      event: "host_allowlist_invalid",
      reason,
      effect: "no host access until config/host-allowlist.json is corrected",
      at: new Date().toISOString(),
    }),
  );
  return new Set<string>();
}

export function parseHostList(text: string): Set<string> {
  let registry: unknown;
  try {
    registry = JSON.parse(text);
  } catch {
    return invalid("not valid JSON");
  }
  const emails =
    registry && typeof registry === "object"
      ? (registry as { emails?: unknown }).emails
      : undefined;
  if (!Array.isArray(emails)) return invalid('expected {"emails": ["…"]}');
  return new Set(
    emails.filter((e): e is string => typeof e === "string").map(normalize),
  );
}

async function hosts(store: Storage): Promise<Set<string>> {
  const entry = cache.get(store);
  if (store.version && entry) {
    const version = await store.version(KEY);
    if (version === entry.version) {
      entry.checked = Date.now();
      return entry.emails;
    }
  }
  const stored = await store.read(KEY);
  if (!stored) {
    cache.delete(store);
    return new Set();
  }
  const emails = parseHostList(stored.data.toString("utf8"));
  if (store.version)
    cache.set(store, { emails, version: stored.etag, checked: Date.now() });
  return emails;
}

export async function authorizedRole(
  store: Storage,
  email: string,
): Promise<"host" | "attendee"> {
  const normalized = normalize(email || "");
  if (!normalized) return "attendee";
  const entry = cache.get(store);
  if (
    entry &&
    !entry.emails.has(normalized) &&
    Date.now() - entry.checked < NOT_HOST_TTL_MS
  )
    return "attendee";
  return (await hosts(store)).has(normalized) ? "host" : "attendee";
}
