// SERVER-ONLY. The bank-feeds database: Postgres, reached with node-postgres.
//
// WHY POSTGRES AND NOT VERCEL BLOB. Email forwarding and chat history keep their
// records in Blob, but the project is on Vercel Hobby, where Blob allows 2,000
// writes a month and locks the whole store for 30 days once that is exceeded
// (vercel.com/docs/vercel-blob/usage-and-pricing). A single synced bank writes
// hundreds of rows on its first pull, and every review click is a write, so
// bank data in Blob would take email forwarding and chat history down with it.
//
// One driver for every environment: a local Postgres in development and tests,
// and a hosted Postgres (Neon through the Vercel Marketplace) in production,
// using its pooled connection string. The pool is cached on globalThis so dev
// hot reloads and warm serverless instances reuse connections.
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

import { MIGRATIONS } from "./schema";

// A bank line's date is a calendar date, not an instant. node-postgres turns a
// DATE column into a JS Date at LOCAL midnight, which toISOString() then shifts
// to the previous day anywhere east of UTC (IST included). Keep it as text.
types.setTypeParser(1082, (value: string) => value);

interface DbGlobal {
  __bankFeedsPools?: Map<string, Pool>;
  __bankFeedsSchemaReady?: Map<string, Promise<void>>;
}
const g = globalThis as DbGlobal;

function poolFor(databaseUrl: string): Pool {
  g.__bankFeedsPools ??= new Map();
  let pool = g.__bankFeedsPools.get(databaseUrl);
  if (!pool) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
    pool = new Pool({
      connectionString: databaseUrl,
      // Serverless instances are many and short-lived; a small pool per
      // instance keeps a hosted database's connection limit safe.
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: local ? undefined : { rejectUnauthorized: true },
    });
    // An idle client erroring (database restart) must not crash the process.
    pool.on("error", () => {});
    g.__bankFeedsPools.set(databaseUrl, pool);
  }
  return pool;
}

/** Thrown for any database failure; routes map it to 503. */
export class BankStoreError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "BankStoreError";
  }
}

export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` in one transaction; rolls back if it throws. */
  tx<T>(fn: (q: Db["query"]) => Promise<T>): Promise<T>;
}

/** Applies pending migrations once per instance, under an advisory lock so two instances never race. */
async function ensureSchema(pool: Pool, databaseUrl: string): Promise<void> {
  g.__bankFeedsSchemaReady ??= new Map();
  let ready = g.__bankFeedsSchemaReady.get(databaseUrl);
  if (!ready) {
    ready = (async () => {
      const client = await pool.connect();
      try {
        // Arbitrary constant; only bank-feeds migrations take this lock.
        await client.query("SELECT pg_advisory_lock(727_416_301)");
        await client.query(
          "CREATE TABLE IF NOT EXISTS bank_schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
        );
        const { rows } = await client.query<{ version: number }>("SELECT version FROM bank_schema_migrations");
        const applied = new Set(rows.map((r) => r.version));
        for (const migration of MIGRATIONS) {
          if (applied.has(migration.version)) continue;
          await client.query("BEGIN");
          try {
            await client.query(migration.sql);
            await client.query("INSERT INTO bank_schema_migrations (version) VALUES ($1)", [migration.version]);
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock(727_416_301)").catch(() => {});
        client.release();
      }
    })();
    // A failed attempt must not be cached, or one transient error would leave
    // the instance permanently unable to reach its tables.
    ready.catch(() => g.__bankFeedsSchemaReady?.delete(databaseUrl));
    g.__bankFeedsSchemaReady.set(databaseUrl, ready);
  }
  return ready;
}

export function openDb(databaseUrl: string): Db {
  const pool = poolFor(databaseUrl);
  const run = async <T extends QueryResultRow>(client: Pool | PoolClient, text: string, params?: unknown[]) => {
    try {
      const result = await client.query<T>(text, params as unknown[] | undefined);
      return result.rows;
    } catch (error) {
      throw new BankStoreError("database query failed", error);
    }
  };
  return {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
      try {
        await ensureSchema(pool, databaseUrl);
      } catch (error) {
        throw new BankStoreError("database unavailable", error);
      }
      return run<T>(pool, text, params);
    },
    async tx<T>(fn: (q: Db["query"]) => Promise<T>): Promise<T> {
      try {
        await ensureSchema(pool, databaseUrl);
      } catch (error) {
        throw new BankStoreError("database unavailable", error);
      }
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        throw new BankStoreError("database unavailable", error);
      }
      try {
        await client.query("BEGIN");
        const out = await fn(<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => run<R>(client, text, params));
        await client.query("COMMIT");
        return out;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/** Tests only: close every pool so the process can exit. */
export async function __closeBankDbForTests(): Promise<void> {
  const pools = g.__bankFeedsPools;
  g.__bankFeedsPools = new Map();
  g.__bankFeedsSchemaReady = new Map();
  if (pools) await Promise.all([...pools.values()].map((p) => p.end().catch(() => {})));
}
