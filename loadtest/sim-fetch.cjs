// Load-test only: preloaded into the app server (NODE_OPTIONS=--require) so
// its outbound calls to Microsoft and Resend reach the local simulator.
// The application code is unchanged and still validates the real hostnames.
const SIM = `http://127.0.0.1:${process.env.SIM_PORT || 4600}`;
const HOSTS = new Set([
  "graph.microsoft.com",
  "login.microsoftonline.com",
  "sim.sharepoint.com",
  "api.resend.com",
]);
const original = globalThis.fetch;
globalThis.fetch = async function simFetch(input, init) {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : String(input));
  if (!HOSTS.has(url.hostname)) return original(input, init);
  const headers = new Headers(req ? req.headers : undefined);
  for (const [k, v] of new Headers(init?.headers)) headers.set(k, v);
  headers.set("x-sim-host", url.hostname);
  const opts = { method: init?.method || req?.method || "GET", headers, body: init?.body ?? (req ? req.body : undefined), signal: init?.signal, redirect: "follow" };
  if (opts.body && typeof opts.body.getReader === "function") opts.duplex = "half";
  return original(SIM + url.pathname + url.search, opts);
};
