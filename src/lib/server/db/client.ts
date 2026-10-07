import "server-only";
import postgres from "postgres";
import { serverEnv } from "@/lib/env/server";

/**
 * Server-only PostgreSQL access via postgres.js.
 *
 * - The connection is created lazily on first query, never at build
 *   time; static tooling (build/lint/typecheck) does not need
 *   DATABASE_URL.
 * - `prepare: false` keeps the client compatible with the Supabase
 *   pooler (Supavisor/PgBouncer transaction mode), which is the
 *   intended production connection path for serverless deployment.
 * - A small pool suffices per serverless instance; the pooler does
 *   the heavy lifting in production.
 * - DATABASE_URL is never logged.
 */

export type Sql = ReturnType<typeof postgres>;

/**
 * Runs a function inside one database transaction. postgres.js types
 * TransactionSql separately from Sql even though the tagged-template
 * query surface repositories use is identical, so this is the single
 * sanctioned bridge: repositories keep the plain Sql parameter type
 * and receive the transaction handle through it.
 */
export async function withTransaction<T>(
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  const sql = getSql();
  return (await sql.begin((tx) => fn(tx as unknown as Sql))) as T;
}

const globalForDb = globalThis as unknown as { avtoshSql?: Sql };

/**
 * Per-INSTANCE pool ceiling. Serverless multiplies this by every
 * concurrently warm function instance (SSR instances + each cron
 * invocation), and Supabase's SESSION pooler caps total clients at
 * the project's pool_size (15 on the incident's compute size):
 * 3 busy instances × 5 connections already exhausted it the moment
 * FULL enabled real page auth plus the four crons aligning on the
 * quarter hour (EMAXCONNSESSION, digest 4291426755). The durable
 * posture is the TRANSACTION pooler for the runtime DATABASE_URL
 * (clients are multiplexed; this app is compatible: prepare:false,
 * sql.begin-only transactions, no advisory locks/LISTEN/session
 * state — and the bounded checker passed 960/960 against the
 * production transaction pooler). DB_POOL_MAX stays as the
 * per-instance tuning knob; raising it is never the fix for
 * exhaustion — fan-out is.
 */
function poolMax(): number {
  const raw = process.env.DB_POOL_MAX;
  if (raw === undefined || raw === "") return 5;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error("DB_POOL_MAX must be an integer in [1, 20].");
  }
  return value;
}

export function getSql(): Sql {
  if (globalForDb.avtoshSql === undefined) {
    const databaseUrl = serverEnv().DATABASE_URL;
    if (databaseUrl === undefined) {
      throw new Error(
        "Database access is not configured: DATABASE_URL is missing from the server environment.",
      );
    }
    globalForDb.avtoshSql = postgres(databaseUrl, {
      max: poolMax(),
      prepare: false,
      // pg_stat_activity attribution: lets operators count exactly
      // this app's connections per instance/pooler during incidents.
      connection: { application_name: "avtosh-runtime" },
      // Serverless connection lifecycle: the platform freezes function
      // instances between invocations and the pooler drops idle
      // clients, silently severing pooled TCP connections (postgres.js
      // default keeps idle connections open forever). Close idle
      // connections proactively and recycle long-lived ones so a
      // thawed instance holds as few stale sockets as possible, and
      // fail connects fast instead of the 30s default. A severed
      // connection is evicted by postgres.js when its query fails; the
      // API layer's bounded read retry then acquires a fresh one.
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return globalForDb.avtoshSql;
}

/** Closes the pool. Used by test tooling for clean shutdown. */
export async function closeSql(): Promise<void> {
  if (globalForDb.avtoshSql !== undefined) {
    await globalForDb.avtoshSql.end();
    globalForDb.avtoshSql = undefined;
  }
}
