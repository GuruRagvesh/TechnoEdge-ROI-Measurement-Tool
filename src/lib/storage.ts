import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { storageLayout } from "./storage-layout";
import { AppError } from "./types";
import { graphMetrics } from "./request-metrics";
import { required, validateConfig } from "./config";

export class Conflict extends Error {}
export type Stored = { data: Buffer; etag: string };
export interface Storage {
  read(key: string): Promise<Stored | null>;
  write(key: string, data: Buffer, expected: string | null): Promise<string>;
  list(prefix: string): Promise<string[]>;
  /** Current version (ETag) of a file without downloading it; null if missing. */
  version?(key: string): Promise<string | null>;
}
export function safeKey(key: string) {
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(key) ||
    key.split("/").some((x) => !x || x === "." || x === "..")
  )
    throw new Error("Invalid storage key");
  return key;
}
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
export class LocalStorage implements Storage {
  constructor(public root = process.env.LOCAL_STORAGE_PATH || ".data") {}
  private file(key: string) {
    return path.resolve(this.root, safeKey(key));
  }
  async read(key: string): Promise<Stored | null> {
    try {
      const data = await readFile(this.file(key));
      return { data, etag: hash(data) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async write(key: string, data: Buffer, expected: string | null) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    const guard = file + ".guard";
    await writeFile(guard, "", { flag: "a" });
    const release = await lockfile.lock(guard, {
      realpath: false,
      stale: 30000,
      update: 5000,
      retries: { retries: 20, minTimeout: 20, maxTimeout: 250 },
    });
    try {
      const old = await this.read(key);
      if ((old?.etag ?? null) !== expected) throw new Conflict();
      const temp = file + "." + randomUUID() + ".tmp";
      await writeFile(temp, data);
      await rename(temp, file);
      return hash(data);
    } finally {
      await release();
    }
  }
  async list(prefix: string) {
    const dir = this.file(prefix);
    try {
      return (await readdir(dir, { withFileTypes: true }))
        .filter((x) => x.isFile() && !/\.(guard|tmp)$/.test(x.name))
        .map((x) => prefix + "/" + x.name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
}
type GraphItem = {
  size?: number;
  id: string;
  name: string;
  eTag: string;
  file?: unknown;
  folder?: unknown;
  "@microsoft.graph.downloadUrl"?: string;
};
export class GraphStorage implements Storage {
  // Per-instance caches that cut SharePoint calls without risking stale data:
  //  - content: keyed by path, valid only while SharePoint reports the same
  //    ETag (checked on every read), small JSON records only;
  //  - ids: file and folder item ids by path (ids never change; a deleted or
  //    replaced file makes the conditional update fail and drops the entry).
  private contentCache = new Map<string, { etag: string; data: Buffer }>();
  private ids = new Map<string, string>();
  private folders = new Map<string, GraphItem>();
  private static readonly CACHE_MAX_ITEM_BYTES = 256 * 1024;
  private static readonly CACHE_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
  private static readonly IDS_MAX = 20000;
  private cacheBytes = 0;
  private remember(key: string, etag: string, data: Buffer) {
    this.forget(key);
    if (data.length > GraphStorage.CACHE_MAX_ITEM_BYTES) return;
    this.contentCache.set(key, { etag, data: Buffer.from(data) });
    this.cacheBytes += data.length;
    // Evict least recently stored entries beyond the memory budget.
    for (const [k, v] of this.contentCache) {
      if (this.cacheBytes <= GraphStorage.CACHE_MAX_TOTAL_BYTES) break;
      this.contentCache.delete(k);
      this.cacheBytes -= v.data.length;
    }
    if (this.ids.size > GraphStorage.IDS_MAX) this.ids.clear();
  }
  private forget(key: string) {
    const old = this.contentCache.get(key);
    if (old) {
      this.contentCache.delete(key);
      this.cacheBytes -= old.data.length;
    }
  }
  private token?: { value: string; expires: number };
  private tokenPending?: Promise<string>;
  private targetPending?: Promise<void>;
  private targetExpires = 0;
  private active = 0;
  private pausedUntil = 0;
  private queue: (() => void)[] = [];
  constructor(
    private fetcher: typeof fetch = fetch,
    private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  private base() {
    return `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(required("GRAPH_DRIVE_ID"))}`;
  }
  private location(key: string) {
    return (
      this.base() +
      "/root:/" +
      safeKey(key).split("/").map(encodeURIComponent).join("/")
    );
  }
  private physical(key: string) {
    const logical = storageLayout(key);
    const root = process.env.GRAPH_STORAGE_ROOT;
    return root ? safeKey(root) + "/" + logical : logical;
  }
  // SharePoint calls in flight per server instance. SharePoint's own limit is
  // per minute (resource units), enforced with 429 + Retry-After, so this cap
  // only needs to stop runaway bursts; at 4 it queued requests for minutes.
  static maxConcurrency() {
    const n = Number(process.env.GRAPH_MAX_CONCURRENCY || 16);
    return Number.isInteger(n) && n >= 1 && n <= 64 ? n : 16;
  }
  // Waiting out SharePoint's Retry-After is bounded: at most 60 s per wait
  // and 120 s in total per API request (Vercel allows 300 s), after which the
  // caller gets a clear "busy, your saved work is safe" error.
  private mayWait(ms: number) {
    const waited = graphMetrics.getStore()?.waitedMs ?? 0;
    return ms <= 60000 && waited + ms <= 120000;
  }
  private async wait(ms: number) {
    const m = graphMetrics.getStore();
    if (m) m.waitedMs += ms;
    await this.sleep(ms);
  }
  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= GraphStorage.maxConcurrency()) {
      if (this.queue.length >= 500)
        throw new AppError(
          503,
          "Storage queue busy; retry safely",
          "STORAGE_THROTTLED",
        );
      await new Promise<void>((r) => this.queue.push(r));
    } else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60000)
      return this.token.value;
    if (!this.tokenPending)
      this.tokenPending = this.acquireToken().finally(() => {
        this.tokenPending = undefined;
      });
    return this.tokenPending;
  }
  private async acquireToken() {
    for (let attempt = 0; attempt < 5; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(
          "https://login.microsoftonline.com/" +
            required("GRAPH_TENANT_ID") +
            "/oauth2/v2.0/token",
          {
            method: "POST",
            body: new URLSearchParams({
              client_id: required("GRAPH_CLIENT_ID"),
              client_secret: required("GRAPH_CLIENT_SECRET"),
              scope: "https://graph.microsoft.com/.default",
              grant_type: "client_credentials",
            }),
            signal: AbortSignal.timeout(20000),
          },
        );
      } catch {
        if (attempt === 4)
          throw new AppError(
            503,
            "Microsoft storage authentication unavailable",
            "STORAGE_UNAVAILABLE",
          );
        await this.sleep(250 * 2 ** attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const delay = this.retryDelay(response, attempt);
        if (attempt === 4 || delay > 20000)
          throw new AppError(
            503,
            "Microsoft authentication busy; retry shortly",
            "STORAGE_THROTTLED",
          );
        await this.sleep(delay);
        continue;
      }
      if (!response.ok)
        throw new AppError(
          503,
          "Microsoft storage authentication unavailable",
          "STORAGE_UNAVAILABLE",
        );
      const t = await response.json();
      if (
        typeof t.access_token !== "string" ||
        !Number.isFinite(Number(t.expires_in))
      )
        throw new AppError(503, "Invalid Microsoft authentication response");
      this.token = {
        value: t.access_token,
        expires: Date.now() + Number(t.expires_in) * 1000,
      };
      return t.access_token as string;
    }
    throw new AppError(503, "Microsoft storage authentication unavailable");
  }
  private retryDelay(response: Response, attempt: number) {
    const retry = response.headers.get("Retry-After");
    const ms = retry
      ? /^\d+$/.test(retry)
        ? Number(retry) * 1000
        : Math.max(0, Date.parse(retry) - Date.now())
      : 500 * 2 ** attempt + Math.random() * 250;
    // Spread retries so throttled callers do not all return at once.
    if (!Number.isFinite(ms)) return 500 * 2 ** attempt;
    const spread = ms * (1 + Math.random() * 0.25);
    return Math.round(ms <= 20000 ? Math.min(spread, 20000) : spread);
  }
  async verifyTarget() {
    if (!process.env.GRAPH_SITE_ID) return;
    if (this.targetExpires > Date.now()) return;
    if (!this.targetPending)
      this.targetPending = this.checkTarget()
        .then(() => {
          this.targetExpires = Date.now() + 300000;
        })
        .finally(() => {
          this.targetPending = undefined;
        });
    return this.targetPending;
  }
  private async checkTarget() {
    const site =
      "https://graph.microsoft.com/v1.0/sites/" +
      encodeURIComponent(required("GRAPH_SITE_ID"));
    const response = await this.request(site + "?$select=id,webUrl");
    if (!response.ok)
      throw new AppError(
        503,
        "Approved SharePoint site is not accessible",
        "STORAGE_TARGET_INVALID",
      );
    const metadata = await response.json();
    const canonical = (url: string) =>
      new URL(url).href.replace(/\/$/, "").toLowerCase();
    if (canonical(metadata.webUrl) !== canonical(required("GRAPH_SITE_URL")))
      throw new AppError(
        503,
        "SharePoint site does not match approved URL",
        "STORAGE_TARGET_INVALID",
      );
    let url = site + "/drives?$select=id,driveType&$top=200";
    for (let page = 0; url && page < 50; page++) {
      if (!url.startsWith(site + "/drives?"))
        throw new AppError(503, "Unexpected SharePoint library pagination");
      const r = await this.request(url);
      if (!r.ok)
        throw new AppError(503, "Cannot verify dedicated SharePoint library");
      const data = await r.json();
      const drive = data.value.find(
        (d: { id: string }) => d.id === required("GRAPH_DRIVE_ID"),
      );
      if (drive) {
        if (drive.driveType !== "documentLibrary")
          throw new AppError(
            503,
            "A company SharePoint document library is required",
            "STORAGE_TARGET_INVALID",
          );
        return;
      }
      url = data["@odata.nextLink"];
    }
    throw new AppError(
      503,
      "Configured library does not belong to the approved site",
      "STORAGE_TARGET_INVALID",
    );
  }
  async downloadLink(key: string) {
    await this.verifyTarget();
    const item = await this.item(this.physical(key));
    const value = item?.["@microsoft.graph.downloadUrl"];
    if (!value) throw new AppError(503, "SharePoint download is unavailable");
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      ![".sharepoint.com", ".1drv.com", ".onedrive.com"].some((h) =>
        url.hostname.endsWith(h),
      )
    )
      throw new AppError(503, "Untrusted SharePoint download URL");
    return value;
  }
  async probeLocation(key: string) {
    return this.location(this.physical(key));
  }
  // Diagnostics: Graph calls slower than 3 s, as "METHOD step-type ms status".
  // No IDs, paths, URLs or tokens are recorded.
  static slowCalls: string[] = [];
  async request(
    url: string,
    init: RequestInit = {},
    authenticated = true,
  ): Promise<Response> {
    const started = Date.now();
    let status = "error";
    try {
      const r = await this.requestOnce(url, init, authenticated);
      status = String(r.status);
      return r;
    } finally {
      const ms = Date.now() - started;
      if (ms > 3000) {
        const u = new URL(url),
          step = !authenticated
            ? "upload-session"
            : /createUploadSession/.test(u.pathname)
              ? "createUploadSession"
              : /\/children$/.test(u.pathname)
                ? "create-folder"
                : /\/content$/.test(u.pathname)
                  ? "content"
                  : /\/sites\/[^/]+$/.test(u.pathname)
                    ? "site-check"
                    : "item-metadata";
        GraphStorage.slowCalls.push(
          `${init.method || "GET"} ${step} ${ms}ms ${status}`,
        );
        if (GraphStorage.slowCalls.length > 20) GraphStorage.slowCalls.shift();
      }
    }
  }
  private async requestOnce(
    url: string,
    init: RequestInit = {},
    authenticated = true,
  ): Promise<Response> {
    if (authenticated && new URL(url).origin !== "https://graph.microsoft.com")
      throw new Error("Invalid Graph API origin");
    for (let attempt = 0; attempt < 5; attempt++) {
      // When SharePoint has said "wait", every request on this instance waits,
      // instead of each one retrying and burning more of the throttled budget.
      const paused = this.pausedUntil - Date.now();
      if (paused > 0) {
        if (!this.mayWait(paused))
          throw new AppError(
            503,
            "Microsoft storage is busy. Your last saved work is safe; retry shortly.",
            "STORAGE_THROTTLED",
          );
        await this.wait(paused + Math.random() * 250);
      }
      let response: Response;
      try {
        const authorization = authenticated
          ? "Bearer " + (await this.accessToken())
          : undefined;
        const m = graphMetrics.getStore();
        const started = Date.now();
        if (m) {
          m.calls++;
          if (attempt) m.retries++;
        }
        try {
          response = await this.limited(() =>
            this.fetcher(url, {
              ...init,
              headers: {
                ...Object.fromEntries(new Headers(init.headers)),
                ...(authenticated ? { Authorization: authorization! } : {}),
              },
              signal: AbortSignal.timeout(30000),
            }),
          );
        } finally {
          if (m) m.ms += Date.now() - started;
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        if (attempt === 4)
          throw new AppError(
            503,
            "Storage connection unavailable; retry safely",
            "STORAGE_UNAVAILABLE",
          );
        await this.sleep(250 * 2 ** attempt);
        continue;
      }
      if (response.status === 401 && authenticated && attempt === 0) {
        this.token = undefined;
        continue;
      }
      if (response.status === 409 || response.status === 412)
        throw new Conflict();
      if (response.status === 429 || response.status >= 500) {
        const ms = this.retryDelay(response, attempt);
        const m = graphMetrics.getStore();
        if (m) {
          m.throttled++;
          m.maxRetryAfterMs = Math.max(m.maxRetryAfterMs, ms);
        }
        if (
          (response.status === 429 || response.status === 503) &&
          response.headers.get("Retry-After")
        )
          this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
        if (attempt === 4 || !this.mayWait(ms))
          throw new AppError(
            503,
            "Microsoft storage is busy. Your last saved work is safe; retry shortly.",
            "STORAGE_THROTTLED",
          );
        if (this.pausedUntil <= Date.now()) await this.wait(ms);
        continue;
      }
      return response;
    }
    throw new AppError(503, "Storage unavailable");
  }
  private async item(key: string): Promise<GraphItem | null> {
    const r = await this.request(this.location(key));
    if (r.status === 404) {
      this.ids.delete(key);
      this.forget(key);
      return null;
    }
    if (!r.ok) throw new AppError(503, "Unable to read storage metadata");
    const item = (await r.json()) as GraphItem;
    if (item?.id) this.ids.set(key, item.id);
    return item;
  }
  async version(key: string): Promise<string | null> {
    await this.verifyTarget();
    return (await this.item(this.physical(key)))?.eTag ?? null;
  }
  async read(key: string): Promise<Stored | null> {
    await this.verifyTarget();
    key = this.physical(key);
    // Content and ETag must describe the same revision; re-read metadata around download.
    for (let i = 0; i < 5; i++) {
      const before = await this.item(key);
      if (!before) return null;
      const hit = this.contentCache.get(key);
      if (hit && hit.etag === before.eTag)
        return { data: Buffer.from(hit.data), etag: hit.etag };
      const r = await this.request(this.base() + `/items/${before.id}/content`);
      if (!r.ok) throw new AppError(503, "Unable to read storage content");
      const data = Buffer.from(await r.arrayBuffer());
      const after = await this.item(key);
      if (before.eTag === after?.eTag) {
        this.remember(key, before.eTag, data);
        return { data, etag: before.eTag };
      }
    }
    throw new AppError(409, "Record changed repeatedly. Refresh and retry.");
  }
  private async folder(key: string): Promise<GraphItem> {
    const known = this.folders.get(key);
    if (known) return known;
    const resolved = await this.resolveFolder(key);
    this.folders.set(key, resolved);
    return resolved;
  }
  private async resolveFolder(key: string): Promise<GraphItem> {
    const existing = await this.item(key);
    if (existing) {
      if (!existing.folder) throw new Error("Storage folder collision");
      return existing;
    }
    const parts = key.split("/");
    const name = parts.pop()!;
    const parent = parts.length ? await this.folder(parts.join("/")) : null;
    try {
      const r = await this.request(
        parent
          ? this.base() + `/items/${parent.id}/children`
          : this.base() + "/root/children",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            folder: {},
            "@microsoft.graph.conflictBehavior": "fail",
          }),
        },
      );
      if (!r.ok) throw new AppError(503, "Unable to create storage folder");
      return r.json();
    } catch (e) {
      if (e instanceof Conflict) {
        const result = await this.item(key);
        if (result?.folder) return result;
      }
      throw e;
    }
  }
  private sessionUrl(value: string) {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      ![".sharepoint.com", ".1drv.com", ".onedrive.com"].some((h) =>
        u.hostname.endsWith(h),
      )
    )
      throw new AppError(503, "Untrusted Microsoft upload endpoint");
    return u.href;
  }
  async createEvidenceSession(key: string) {
    await this.verifyTarget();
    const physical = this.physical(key),
      parts = physical.split("/"),
      name = parts.pop()!,
      parent = await this.folder(parts.join("/"));
    const r = await this.request(
      this.base() +
        `/items/${parent.id}:/${encodeURIComponent(name)}:/createUploadSession`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Annotation first, as in write(), which Graph accepts.
          // "replace": the path is content-addressed per participant, task and
          // checksum, so the only thing replaced is an empty placeholder left
          // by an earlier, expired session for this same file.
          item: { "@microsoft.graph.conflictBehavior": "replace", name },
        }),
      },
    );
    if (!r.ok) {
      // Report Microsoft's status and error code (never a URL or token) so
      // operators can act; e.g. 403 accessDenied vs 400 invalidRequest.
      const detail = await r
        .json()
        .then((b) =>
          [b?.error?.code, b?.error?.message]
            .filter(Boolean)
            .join(": ")
            .replace(/https?:\/\/\S+/g, "")
            .replace(/[^\w .,:;'()\/-]/g, "")
            .slice(0, 160),
        )
        .catch(() => "");
      throw new AppError(
        503,
        `Unable to prepare evidence upload (SharePoint ${r.status}${detail ? " " + detail : ""})`,
      );
    }
    const data = await r.json();
    return {
      uploadUrl: this.sessionUrl(data.uploadUrl),
      expiresAt: data.expirationDateTime as string,
    };
  }
  async evidenceSessionStatus(value: string) {
    const r = await this.request(this.sessionUrl(value), {}, false);
    if (r.status === 404 || r.status === 410) return null;
    if (!r.ok) throw new AppError(503, "Upload status unavailable");
    const data = await r.json(),
      offset = Number(data.nextExpectedRanges?.[0]?.split("-")[0]);
    if (!Number.isInteger(offset) || offset < 0)
      throw new AppError(503, "Invalid Microsoft upload status");
    return { offset, expiresAt: data.expirationDateTime as string | undefined };
  }
  async evidenceFileSize(key: string) {
    await this.verifyTarget();
    const item = await this.item(this.physical(key));
    return item
      ? typeof item.size === "number"
        ? item.size
        : Promise.reject(new AppError(503, "Invalid evidence metadata"))
      : null;
  }
  async cancelEvidenceSession(value: string) {
    const r = await this.request(
      this.sessionUrl(value),
      { method: "DELETE" },
      false,
    );
    if (!r.ok && r.status !== 404 && r.status !== 410)
      throw new AppError(503, "Unable to cancel upload session");
  }
  async write(key: string, data: Buffer, expected: string | null) {
    await this.verifyTarget();
    key = this.physical(key);
    safeKey(key);
    const parts = key.split("/");
    const name = parts.pop()!;
    if (expected !== null) {
      // SharePoint enforces If-Match, so no separate metadata check is needed.
      let id = this.ids.get(key);
      if (!id) {
        const current = await this.item(key);
        if (!current || current.eTag !== expected) throw new Conflict();
        id = current.id;
      }
      let r: Response;
      try {
        r = await this.request(this.base() + `/items/${id}/content`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "If-Match": expected,
          },
          body: new Uint8Array(data),
        });
      } catch (e) {
        if (e instanceof Conflict) this.forget(key);
        throw e;
      }
      if (r.status === 404) {
        this.ids.delete(key);
        this.forget(key);
        throw new Conflict();
      }
      if (!r.ok) throw new AppError(503, "Unable to save record");
      const etag = (await r.json()).eTag as string;
      this.remember(key, etag, data);
      return etag;
    }
    const parent = await this.folder(parts.join("/"));
    const s = await this.request(
      this.base() +
        `/items/${parent.id}:/${encodeURIComponent(name)}:/createUploadSession`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: { "@microsoft.graph.conflictBehavior": "fail", name },
        }),
      },
    );
    if (!s.ok) throw new AppError(503, "Unable to begin upload");
    const session = await s.json();
    const uploadUrl = new URL(session.uploadUrl);
    if (
      uploadUrl.protocol !== "https:" ||
      uploadUrl.username ||
      uploadUrl.password ||
      ![".sharepoint.com", ".1drv.com", ".onedrive.com"].some((host) =>
        uploadUrl.hostname.endsWith(host),
      )
    )
      throw new AppError(503, "Untrusted Microsoft upload endpoint");
    // 5 MiB is a multiple of 320 KiB. The service confirms the next range before advancing.
    const chunk = 5 * 1024 * 1024;
    let offset = 0,
      steps = 0;
    while (
      offset < data.length &&
      steps++ < Math.ceil(data.length / chunk) * 4 + 8
    ) {
      const end = Math.min(data.length, offset + chunk);
      let r: Response;
      try {
        r = await this.request(
          uploadUrl.href,
          {
            method: "PUT",
            headers: {
              "Content-Length": String(end - offset),
              "Content-Range":
                "bytes " + offset + "-" + (end - 1) + "/" + data.length,
            },
            body: new Uint8Array(data.subarray(offset, end)),
          },
          false,
        );
      } catch (e) {
        throw e;
      }
      if (r.status === 416) {
        r = await this.request(uploadUrl.href, {}, false);
      }
      if (r.status === 200 || r.status === 201) {
        const result = await r.json();
        if (result.eTag) {
          if (result.id) this.ids.set(key, result.id);
          this.remember(key, result.eTag, data);
          return result.eTag as string;
        }
        const next = Number(result.nextExpectedRanges?.[0]?.split("-")[0]);
        if (!Number.isInteger(next) || next < 0 || next >= data.length)
          throw new AppError(503, "Invalid upload recovery range");
        offset = next;
        continue;
      }
      if (r.status === 202) {
        const result = await r.json();
        const next = Number(result.nextExpectedRanges?.[0]?.split("-")[0]);
        if (!Number.isInteger(next) || next < 0 || next >= data.length)
          throw new AppError(503, "Invalid Microsoft upload range");
        offset = next;
        continue;
      }
      throw new AppError(
        503,
        "Upload not committed; retry safely",
        "STORAGE_UNAVAILABLE",
      );
    }
    throw new AppError(
      503,
      "Upload did not converge; retry safely",
      "STORAGE_UNAVAILABLE",
    );
  }

  async list(prefix: string) {
    await this.verifyTarget();
    const logicalPrefix = prefix;
    prefix = this.physical(prefix);
    const folder = await this.item(prefix);
    if (!folder) return [];
    let url =
      this.base() +
      `/items/${folder.id}/children?$select=id,name,file,folder&$top=200`;
    const result: string[] = [];
    while (url) {
      if (!url.startsWith(this.base() + "/"))
        throw new Error("Invalid Graph pagination");
      const r = await this.request(url);
      if (!r.ok) throw new AppError(503, "Unable to list storage records");
      const page = await r.json();
      result.push(
        ...page.value
          .filter((x: GraphItem) => x.file)
          .map((x: GraphItem) => logicalPrefix + "/" + x.name),
      );
      url = page["@odata.nextLink"];
    }
    return result;
  }
}
let instance: Storage;
export function storage() {
  validateConfig();
  return (instance ??=
    process.env.STORAGE_ADAPTER === "graph"
      ? new GraphStorage()
      : new LocalStorage());
}
// A 0-byte record is an empty placeholder left by an interrupted create (an
// upload session opens it before any content arrives). It holds no data, so it
// reads as "no record yet"; the next write replaces it under its own ETag.
const record = <T>(data: Buffer): T | null =>
  data.length ? (JSON.parse(data.toString()) as T) : null;
export async function getJson<T>(s: Storage, key: string): Promise<T | null> {
  const r = await s.read(key);
  return r ? record<T>(r.data) : null;
}
export async function mutate<T>(
  s: Storage,
  key: string,
  fn: (old: T | null) => T,
): Promise<T> {
  for (let i = 0; i < 8; i++) {
    const before = await s.read(key);
    const value = fn(before ? record<T>(before.data) : null);
    try {
      await s.write(
        key,
        Buffer.from(JSON.stringify(value)),
        before?.etag ?? null,
      );
      return value;
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      // Back off briefly with jitter so colliding writers do not retry in lockstep.
      await new Promise((r) => setTimeout(r, Math.random() * 40 * (i + 1)));
    }
  }
  throw new AppError(
    409,
    "Concurrent edit detected. Reload your saved work before retrying.",
    "CONFLICT",
  );
}
export async function createJson<T>(s: Storage, key: string, value: T) {
  try {
    await s.write(key, Buffer.from(JSON.stringify(value)), null);
    return value;
  } catch (e) {
    if (!(e instanceof Conflict)) throw e;
    const existing = await getJson<T>(s, key);
    // An empty placeholder is replaced; a real record wins.
    return existing ?? mutate<T>(s, key, (old) => old ?? value);
  }
}
