import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { storageLayout } from "./storage-layout";
import { AppError } from "./types";
import { required, validateConfig } from "./config";

export class Conflict extends Error {}
export type Stored = { data: Buffer; etag: string };
export interface Storage {
  read(key: string): Promise<Stored | null>;
  write(key: string, data: Buffer, expected: string | null): Promise<string>;
  list(prefix: string): Promise<string[]>;
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
  private token?: { value: string; expires: number };
  private tokenPending?: Promise<string>;
  private targetPending?: Promise<void>;
  private targetExpires = 0;
  private active = 0;
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
  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= 4) {
      if (this.queue.length >= 200)
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
    return Number.isFinite(ms) ? ms : 500 * 2 ** attempt;
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
  async request(
    url: string,
    init: RequestInit = {},
    authenticated = true,
  ): Promise<Response> {
    if (authenticated && new URL(url).origin !== "https://graph.microsoft.com")
      throw new Error("Invalid Graph API origin");
    for (let attempt = 0; attempt < 5; attempt++) {
      let response: Response;
      try {
        const authorization = authenticated
          ? "Bearer " + (await this.accessToken())
          : undefined;
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
        if (attempt === 4 || ms > 20000)
          throw new AppError(
            503,
            "Microsoft storage is busy. Your last saved work is safe; retry shortly.",
            "STORAGE_THROTTLED",
          );
        await this.sleep(ms);
        continue;
      }
      return response;
    }
    throw new AppError(503, "Storage unavailable");
  }
  private async item(key: string): Promise<GraphItem | null> {
    const r = await this.request(this.location(key));
    if (r.status === 404) return null;
    if (!r.ok) throw new AppError(503, "Unable to read storage metadata");
    return r.json();
  }
  async read(key: string): Promise<Stored | null> {
    await this.verifyTarget();
    key = this.physical(key);
    // Content and ETag must describe the same revision; re-read metadata around download.
    for (let i = 0; i < 5; i++) {
      const before = await this.item(key);
      if (!before) return null;
      const r = await this.request(this.base() + `/items/${before.id}/content`);
      if (!r.ok) throw new AppError(503, "Unable to read storage content");
      const data = Buffer.from(await r.arrayBuffer());
      const after = await this.item(key);
      if (before.eTag === after?.eTag) return { data, etag: before.eTag };
    }
    throw new AppError(409, "Record changed repeatedly. Refresh and retry.");
  }
  private async folder(key: string): Promise<GraphItem> {
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
          item: { name, "@microsoft.graph.conflictBehavior": "fail" },
        }),
      },
    );
    if (!r.ok) {
      // Report Microsoft's status and error code (never a URL or token) so
      // operators can act; e.g. 403 accessDenied vs 400 invalidRequest.
      const code = await r
        .json()
        .then((b) =>
          String(b?.error?.code || "").replace(/[^A-Za-z0-9_.-]/g, ""),
        )
        .catch(() => "");
      throw new AppError(
        503,
        `Unable to prepare evidence upload (SharePoint ${r.status}${code ? " " + code : ""})`,
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
    const parent = await this.folder(parts.join("/"));
    if (expected !== null) {
      const current = await this.item(key);
      if (!current || current.eTag !== expected) throw new Conflict();
      const r = await this.request(
        this.base() + `/items/${current.id}/content`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "If-Match": expected,
          },
          body: new Uint8Array(data),
        },
      );
      if (!r.ok) throw new AppError(503, "Unable to save record");
      return (await r.json()).eTag as string;
    }
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
        if (result.eTag) return result.eTag as string;
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
export async function getJson<T>(s: Storage, key: string): Promise<T | null> {
  const r = await s.read(key);
  return r ? JSON.parse(r.data.toString()) : null;
}
export async function mutate<T>(
  s: Storage,
  key: string,
  fn: (old: T | null) => T,
): Promise<T> {
  for (let i = 0; i < 8; i++) {
    const before = await s.read(key);
    const value = fn(before ? JSON.parse(before.data.toString()) : null);
    try {
      await s.write(
        key,
        Buffer.from(JSON.stringify(value)),
        before?.etag ?? null,
      );
      return value;
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
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
    if (e instanceof Conflict) return (await getJson<T>(s, key))!;
    throw e;
  }
}
