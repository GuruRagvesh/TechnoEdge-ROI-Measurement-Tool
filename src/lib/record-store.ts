import { Pool, type PoolConfig } from "pg";
import { AppError } from "./types";
import { graphMetrics } from "./request-metrics";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

// Live application records (sign-in, sessions, rooms, participants, autosave)
// kept in PostgreSQL. Each record is the same JSON document the app would
// store in SharePoint, with an integer version that plays the part of the
// SharePoint ETag: a write names the version it read, and loses if anyone
// else wrote first. Evidence files and exports stay in SharePoint.
export type RecordRow = { data: Buffer; etag: string };

const etagOf = (version: string | number) => `"pg-${version}"`;
const versionOf = (etag: string) => {
  const m = /^"pg-(\d+)"$/.exec(etag);
  return m ? m[1] : null;
};

// DATABASE_URL, or POSTGRES_URL as set by the Vercel Supabase integration
// (its pooled, serverless-safe connection). DATABASE_SSL=no-verify encrypts
// the connection without checking the server certificate (libpq
// "sslmode=require"), for providers whose pooler certificate is not publicly
// trusted; the default verifies the certificate.
export function databaseUrl() {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!raw || process.env.DATABASE_SSL !== "no-verify") return raw;
  const url = new URL(raw);
  url.searchParams.set("sslmode", "require");
  url.searchParams.set("uselibpqcompat", "true");
  return url.toString();
}

// A Supabase host is verified against Supabase's own root certificate, with
// full hostname checking. sslmode is removed from the URL because the driver
// would otherwise replace these TLS settings with its own.
export function connectionConfig(connectionString: string): PoolConfig {
  if (!connectionString || process.env.DATABASE_SSL === "no-verify")
    return { connectionString };
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { connectionString };
  }
  if (!url.hostname.endsWith(".supabase.com") && !url.hostname.endsWith(".supabase.co"))
    return { connectionString };
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
  };
}

export class PostgresRecords {
  private pool: Pool;
  private ready?: Promise<void>;
  constructor(config: string | PoolConfig = databaseUrl()) {
    const base: PoolConfig =
      typeof config === "string" ? connectionConfig(config) : config;
    if (!base.connectionString && !base.host)
      throw new Error(
        "DATABASE_URL (or POSTGRES_URL) is required when RECORD_STORE=postgres",
      );
    this.pool = new Pool({
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 10000,
      query_timeout: 12000,
      ...base,
    });
    // An idle client that loses its connection must not crash the function.
    this.pool.on("error", () => {});
  }

  private async query<R extends object>(text: string, values: unknown[]) {
    await (this.ready ??= this.migrate());
    const m = graphMetrics.getStore();
    const started = Date.now();
    try {
      return await this.pool.query<R>(text, values);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw Object.assign(
        new AppError(
          503,
          "The database is unavailable. Your last saved work is safe; retry shortly.",
          "DATABASE_UNAVAILABLE",
        ),
        { cause: { code: (e as { code?: string })?.code } },
      );
    } finally {
      if (m) {
        m.dbQueries = (m.dbQueries ?? 0) + 1;
        m.dbMs = (m.dbMs ?? 0) + Date.now() - started;
      }
    }
  }

  private async migrate() {
    try {
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS app_records (
           key text PRIMARY KEY,
           data bytea NOT NULL,
           version bigint NOT NULL DEFAULT 1,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      // Hosted Postgres (Supabase) also publishes tables through its own web
      // API. Row-level security with no policies closes that path; the app's
      // own connection owns the table and is not affected.
      await this.pool.query(
        "ALTER TABLE app_records ENABLE ROW LEVEL SECURITY",
      );
    } catch (e) {
      this.ready = undefined;
      console.error(
        JSON.stringify({
          event: "database_unavailable",
          code: (e as { code?: string })?.code,
          at: new Date().toISOString(),
        }),
      );
      throw Object.assign(
        new AppError(
          503,
          "The database is unavailable. Your last saved work is safe; retry shortly.",
          "DATABASE_UNAVAILABLE",
        ),
        { cause: { code: (e as { code?: string })?.code } },
      );
    }
  }

  async read(key: string): Promise<RecordRow | null> {
    const r = await this.query<{ data: Buffer; version: string }>(
      "SELECT data, version FROM app_records WHERE key = $1",
      [key],
    );
    const row = r.rows[0];
    return row ? { data: row.data, etag: etagOf(row.version) } : null;
  }

  /** Creates the record; null if it already exists. */
  async create(key: string, data: Buffer): Promise<string | null> {
    const r = await this.query<{ version: string }>(
      `INSERT INTO app_records (key, data) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING RETURNING version`,
      [key, data],
    );
    return r.rows[0] ? etagOf(r.rows[0].version) : null;
  }

  /** Replaces the record if it is still at `expected`; null if not. */
  async update(
    key: string,
    data: Buffer,
    expected: string,
  ): Promise<string | null> {
    const version = versionOf(expected);
    if (!version) return null;
    const r = await this.query<{ version: string }>(
      `UPDATE app_records SET data = $2, version = version + 1, updated_at = now()
       WHERE key = $1 AND version = $3 RETURNING version`,
      [key, data, version],
    );
    return r.rows[0] ? etagOf(r.rows[0].version) : null;
  }

  /** Direct children of a folder-like prefix, as full keys. */
  async children(prefix: string): Promise<string[]> {
    const r = await this.query<{ key: string }>(
      `SELECT key FROM app_records
       WHERE starts_with(key, $1) AND strpos(substr(key, length($1) + 1), '/') = 0
       ORDER BY key`,
      [prefix + "/"],
    );
    return r.rows.map((x) => x.key);
  }

  /** Every record, oldest key first, in pages (for copying back to SharePoint). */
  async *all(pageSize = 200): AsyncGenerator<{ key: string; data: Buffer }> {
    let after = "";
    for (;;) {
      const r = await this.query<{ key: string; data: Buffer }>(
        "SELECT key, data FROM app_records WHERE key > $1 ORDER BY key LIMIT $2",
        [after, pageSize],
      );
      for (const row of r.rows) yield row;
      if (r.rows.length < pageSize) return;
      after = r.rows[r.rows.length - 1].key;
    }
  }

  /** One round trip to the database; throws 503 if it is unreachable. */
  async ping() {
    await this.query("SELECT 1", []);
  }

  async end() {
    await this.pool.end();
  }
}
