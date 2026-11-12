import { AsyncLocalStorage } from "node:async_hooks";

// Per-request SharePoint (Microsoft Graph) usage, reported in the request log
// line so throttling and slow storage are visible in Vercel logs. Counts and
// timings only: no URLs, identifiers, answers or tokens.
export type GraphMetrics = {
  calls: number;
  throttled: number;
  retries: number;
  ms: number;
  maxRetryAfterMs: number;
  waitedMs: number;
};
export const graphMetrics = new AsyncLocalStorage<GraphMetrics>();
export const newGraphMetrics = (): GraphMetrics => ({
  calls: 0,
  throttled: 0,
  retries: 0,
  ms: 0,
  maxRetryAfterMs: 0,
  waitedMs: 0,
});
