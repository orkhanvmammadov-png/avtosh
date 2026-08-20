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

export function getSql(): Sql {
  if (globalForDb.avtoshSql === undefined) {
    const databaseUrl = serverEnv().DATABASE_URL;
    if (databaseUrl === undefined) {
      throw new Error(
        "Database access is not configured: DATABASE_URL is missing from the server environment.",
      );
    }
    globalForDb.avtoshSql = postgres(databaseUrl, {
      max: 5,
      prepare: false,
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
