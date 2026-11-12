// Isolated Microsoft Graph / SharePoint simulator for load tests.
// Never used in production. Models what matters for capacity:
//  - SharePoint app throttling: 1,250 resource units (RU) per minute per app
//    for tenants with 0-1,000 licenses (Microsoft: "Avoid getting throttled or
//    blocked in SharePoint Online"); throttled requests also count.
//  - RU costs: get item / download = 1, list children / create / update /
//    upload = 2.
//  - 429 with Retry-After when over budget; optional injected 503s and drops.
//  - SharePoint behaviour the app depends on: ETag/If-Match, conflictBehavior,
//    empty placeholder created when an upload session opens.
//  - Latency calibrated to production (~250 ms per Graph call from bom1).
import http from "node:http";
import { randomUUID, createHash } from "node:crypto";

const PORT = Number(process.env.SIM_PORT || 4600);
const RU_PER_MIN = Number(process.env.SIM_RU_PER_MIN || 1250);
const LATENCY = Number(process.env.SIM_LATENCY_SCALE || 1);
const FAULT_503 = Number(process.env.SIM_FAULT_503 || 0); // probability
const FAULT_DROP = Number(process.env.SIM_FAULT_DROP || 0); // probability
const DRIVE = process.env.GRAPH_DRIVE_ID || "sim-drive";
const SITE_URL = process.env.GRAPH_SITE_URL || "https://sim.sharepoint.com/sites/LoadTest";
const T0 = Date.now();

const items = new Map(); // id -> item
const byPath = new Map(); // lowercased path -> id
const sessions = new Map(); // upload session id -> {itemId, size, received, parts, expires, name, parentId}
const mail = new Map(); // email -> latest code
items.set("root", { id: "root", name: "root", parent: null, folder: true, eTag: '"root"' });
byPath.set("", "root");

// ---------- metrics ----------
const ledger = []; // [ts, ru]
const stats = { calls: {}, status: {}, ru: 0, throttled: 0, injected503: 0, drops: 0, retryAfter: [], perMinute: {} };
function count(op, status) {
  stats.calls[op] = (stats.calls[op] || 0) + 1;
  stats.status[status] = (stats.status[status] || 0) + 1;
}
function budgetUsed(now) {
  while (ledger.length && ledger[0][0] <= now - 60000) ledger.shift();
  return ledger.reduce((a, [, r]) => a + r, 0);
}
function charge(ru) {
  const now = Date.now();
  const used = budgetUsed(now);
  ledger.push([now, ru]); // throttled requests count too
  stats.ru += ru;
  const minute = Math.floor((now - T0) / 60000);
  stats.perMinute[minute] = (stats.perMinute[minute] || 0) + ru;
  if (used + ru > RU_PER_MIN) {
    // Seconds until enough of the window expires to fit this request.
    let need = used + ru - RU_PER_MIN, t = now;
    for (const [ts, r] of ledger) { need -= r; t = ts; if (need <= 0) break; }
    const retry = Math.max(1, Math.ceil((t + 60000 - now) / 1000));
    stats.throttled++;
    stats.retryAfter.push(retry);
    return retry;
  }
  return 0;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo, hi) => (lo + Math.random() * (hi - lo)) * LATENCY;

// ---------- helpers ----------
const etag = () => `"{${randomUUID()}},1"`;
function meta(it) {
  const m = { id: it.id, name: it.name, eTag: it.eTag, cTag: it.eTag };
  if (it.folder) m.folder = { childCount: [...items.values()].filter((x) => x.parent === it.id).length };
  else { m.file = { mimeType: "application/octet-stream" }; m.size = it.data.length; m["@microsoft.graph.downloadUrl"] = `https://sim.sharepoint.com/dl/${it.id}?t=${Date.now()}`; }
  return m;
}
function pathOf(id) {
  const parts = [];
  for (let it = items.get(id); it && it.id !== "root"; it = items.get(it.parent)) parts.unshift(it.name);
  return parts.join("/");
}
function child(parentId, name) {
  const p = pathOf(parentId);
  return byPath.get(((p ? p + "/" : "") + name).toLowerCase());
}
function create(parentId, name, props) {
  const it = { id: randomUUID().replace(/-/g, ""), name, parent: parentId, eTag: etag(), ...props };
  items.set(it.id, it);
  byPath.set(pathOf(it.id).toLowerCase(), it.id);
  return it;
}
function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body === undefined ? "" : JSON.stringify(body));
  res.writeHead(status, { "Content-Type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json", "Content-Length": buf.length, ...headers });
  res.end(buf);
}
const notFound = (res) => send(res, 404, { error: { code: "itemNotFound", message: "Item not found" } });
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const host = (req.headers["x-sim-host"] || "").toLowerCase();
  const url = new URL(req.url, "http://sim");
  const p = decodeURIComponent(url.pathname);
  try {
    // --- control endpoints (not part of Graph) ---
    if (!host) {
      if (p === "/__stats") {
        const now = Date.now();
        const ra = stats.retryAfter.slice().sort((a, b) => a - b);
        return send(res, 200, { ...stats, retryAfter: { n: ra.length, p50: ra[Math.floor(ra.length / 2)] ?? null, max: ra.at(-1) ?? null }, windowRU: budgetUsed(now), files: [...items.values()].filter((x) => !x.folder).length, uptimeS: Math.round((now - T0) / 1000) });
      }
      if (p === "/__mail") return send(res, 200, { code: mail.get((url.searchParams.get("email") || "").toLowerCase()) || null });
      if (p === "/__put" && req.method === "POST") { // seed a file by logical path
        const parts = (url.searchParams.get("path") || "").split("/").filter(Boolean);
        let parent = "root";
        for (const name of parts.slice(0, -1)) parent = child(parent, name) || create(parent, name, { folder: true }).id;
        const data = await body(req), name = parts.at(-1), id = child(parent, name);
        if (id) { const it = items.get(id); it.data = data; it.eTag = etag(); } else create(parent, name, { data });
        return send(res, 200, { ok: true });
      }
      if (p === "/__file") { // read a stored file by logical path (for integrity checks)
        const id = byPath.get((url.searchParams.get("path") || "").toLowerCase());
        const it = id && items.get(id);
        return it && !it.folder ? send(res, 200, it.data) : notFound(res);
      }
      return notFound(res);
    }
    if (host === "api.resend.com") {
      const b = JSON.parse((await body(req)).toString());
      const code = /code is (\d{6})/.exec(b.text || "")?.[1];
      for (const to of b.to || []) mail.set(String(to).toLowerCase(), code);
      count("resend", 200);
      return send(res, 200, { id: randomUUID() });
    }
    if (host === "login.microsoftonline.com") {
      await body(req);
      await sleep(jitter(80, 200));
      count("token", 200);
      return send(res, 200, { access_token: "sim-token", expires_in: 3599, token_type: "Bearer" });
    }
    if (FAULT_DROP && Math.random() < FAULT_DROP) { stats.drops++; req.socket.destroy(); return; }

    // --- SharePoint pre-authenticated upload / download URLs ---
    if (host === "sim.sharepoint.com") {
      const up = /^\/up\/([a-f0-9-]+)$/.exec(p);
      const dl = /^\/dl\/([a-z0-9]+)$/.exec(p);
      if (dl) {
        const wait = charge(1); await sleep(jitter(120, 260));
        if (wait) { count("download", 429); await body(req); return send(res, 429, { error: { code: "activityLimitReached" } }, { "Retry-After": String(wait) }); }
        const it = items.get(dl[1]); count("download", it ? 200 : 404);
        return it ? send(res, 200, it.data) : notFound(res);
      }
      if (!up) return notFound(res);
      const s = sessions.get(up[1]);
      if (req.method === "DELETE") { await body(req); sessions.delete(up[1]); count("upload-cancel", 204); return send(res, 204, undefined); }
      if (req.method === "GET") {
        await sleep(jitter(80, 180)); count("upload-status", s ? 200 : 404);
        if (!s || s.expires < Date.now()) return send(res, 404, { error: { code: "itemNotFound" } });
        return send(res, 200, { expirationDateTime: new Date(s.expires).toISOString(), nextExpectedRanges: [`${s.received}-`] });
      }
      // PUT chunk
      const data = await body(req);
      const wait = charge(2);
      await sleep(jitter(150, 300) + (data.length / (20 * 1024 * 1024)) * 1000);
      if (wait) { count("upload-chunk", 429); return send(res, 429, { error: { code: "activityLimitReached" } }, { "Retry-After": String(wait) }); }
      if (FAULT_503 && Math.random() < FAULT_503) { stats.injected503++; count("upload-chunk", 503); return send(res, 503, { error: { code: "serviceNotAvailable" } }, { "Retry-After": "2" }); }
      if (!s || s.expires < Date.now()) { count("upload-chunk", 404); return send(res, 404, { error: { code: "itemNotFound" } }); }
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers["content-range"] || "");
      if (!m) { count("upload-chunk", 400); return send(res, 400, { error: { code: "invalidRange" } }); }
      const [start, end, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!s.size) s.size = total;
      if (start !== s.received || total !== s.size || data.length !== end - start + 1) { count("upload-chunk", 416); return send(res, 416, { error: { code: "invalidRange" } }); }
      s.parts.push(data); s.received = end + 1;
      if (s.received < s.size) { count("upload-chunk", 202); return send(res, 202, { expirationDateTime: new Date(s.expires).toISOString(), nextExpectedRanges: [`${s.received}-`] }); }
      const it = items.get(s.itemId);
      it.data = Buffer.concat(s.parts); it.eTag = etag();
      sessions.delete(up[1]);
      count("upload-chunk", 201);
      return send(res, 201, meta(it));
    }

    if (host !== "graph.microsoft.com") return notFound(res);
    // --- Graph API ---
    const g = p.replace(/^\/v1\.0/, "");
    const auth = req.headers.authorization === "Bearer sim-token";
    if (!auth) return send(res, 401, { error: { code: "InvalidAuthenticationToken" } });
    let op, ru;
    const site = /^\/sites\/([^/]+)$/.exec(g), drives = /^\/sites\/([^/]+)\/drives$/.exec(g);
    const byRoot = new RegExp(`^/drives/${DRIVE}/root:/(.+)$`).exec(g);
    const content = new RegExp(`^/drives/${DRIVE}/items/([^/]+)/content$`).exec(g);
    const children = new RegExp(`^/drives/${DRIVE}/(?:items/([^/:]+)|root)/children$`).exec(g);
    const session = new RegExp(`^/drives/${DRIVE}/items/([^/:]+):/([^/]+):/createUploadSession$`).exec(g);
    if (site) [op, ru] = ["site", 1];
    else if (drives) [op, ru] = ["drives", 2];
    else if (byRoot && req.method === "GET") [op, ru] = ["get-item", 1];
    else if (content && req.method === "GET") [op, ru] = ["download", 1];
    else if (content && req.method === "PUT") [op, ru] = ["update", 2];
    else if (children && req.method === "GET") [op, ru] = ["list", 2];
    else if (children && req.method === "POST") [op, ru] = ["create-folder", 2];
    else if (session && req.method === "POST") [op, ru] = ["create-upload-session", 2];
    else { await body(req); count("unknown " + req.method + " " + g, 404); return notFound(res); }
    const payload = await body(req);
    const wait = charge(ru);
    await sleep(op === "update" || op.startsWith("create") ? jitter(300, 700) : jitter(150, 350));
    if (wait) { count(op, 429); return send(res, 429, { error: { code: "activityLimitReached", message: "throttled" } }, { "Retry-After": String(wait) }); }
    if (FAULT_503 && Math.random() < FAULT_503) { stats.injected503++; count(op, 503); return send(res, 503, { error: { code: "serviceNotAvailable" } }, { "Retry-After": "2" }); }

    if (op === "site") { count(op, 200); return send(res, 200, { id: decodeURIComponent(site[1]), webUrl: SITE_URL }); }
    if (op === "drives") { count(op, 200); return send(res, 200, { value: [{ id: DRIVE, driveType: "documentLibrary" }] }); }
    if (op === "get-item") {
      const id = byPath.get(byRoot[1].replace(/:$/, "").toLowerCase());
      count(op, id ? 200 : 404);
      return id ? send(res, 200, meta(items.get(id))) : notFound(res);
    }
    if (op === "download") {
      const it = items.get(content[1]); count(op, it && !it.folder ? 200 : 404);
      return it && !it.folder ? send(res, 200, it.data) : notFound(res);
    }
    if (op === "update") {
      const it = items.get(content[1]);
      if (!it || it.folder) { count(op, 404); return notFound(res); }
      const match = req.headers["if-match"];
      if (match && match !== it.eTag) { count(op, 412); return send(res, 412, { error: { code: "preconditionFailed" } }); }
      it.data = payload; it.eTag = etag(); count(op, 200);
      return send(res, 200, meta(it));
    }
    if (op === "list") {
      const parentId = children[1] || "root";
      const all = [...items.values()].filter((x) => x.parent === parentId).sort((a, b) => a.name.localeCompare(b.name));
      const top = Number(url.searchParams.get("$top") || 200), skip = Number(url.searchParams.get("$skiptoken") || 0);
      const page = all.slice(skip, skip + top);
      const next = skip + top < all.length ? `https://graph.microsoft.com/v1.0${g}?$select=id,name,file,folder&$top=${top}&$skiptoken=${skip + top}` : undefined;
      count(op, 200);
      return send(res, 200, { value: page.map(meta), ...(next ? { "@odata.nextLink": next } : {}) });
    }
    if (op === "create-folder") {
      const b = JSON.parse(payload.toString());
      const parentId = children[1] || "root";
      const existing = child(parentId, b.name);
      if (existing) { count(op, 409); return send(res, 409, { error: { code: "nameAlreadyExists" } }); }
      const it = create(parentId, b.name, { folder: true }); count(op, 201);
      return send(res, 201, meta(it));
    }
    if (op === "create-upload-session") {
      const b = JSON.parse(payload.toString() || "{}");
      const behavior = b.item?.["@microsoft.graph.conflictBehavior"] || "fail";
      const parentId = session[1], name = session[2];
      let id = child(parentId, name);
      if (id && behavior === "fail") { count(op, 409); return send(res, 409, { error: { code: "nameAlreadyExists" } }); }
      // SharePoint creates an empty placeholder when the session opens.
      if (!id) id = create(parentId, name, { data: Buffer.alloc(0) }).id;
      const sid = randomUUID();
      sessions.set(sid, { itemId: id, size: Number(req.headers["x-sim-size"] || 0), received: 0, parts: [], expires: Date.now() + 3600000 });
      count(op, 200);
      return send(res, 200, { uploadUrl: `https://sim.sharepoint.com/up/${sid}`, expirationDateTime: new Date(Date.now() + 3600000).toISOString() });
    }
  } catch (e) {
    count("sim-error", 500);
    send(res, 500, { error: { code: "simError", message: String(e).slice(0, 200) } });
  }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, "127.0.0.1", () => console.log(JSON.stringify({ sim: "listening", port: PORT, ruPerMin: RU_PER_MIN })));
