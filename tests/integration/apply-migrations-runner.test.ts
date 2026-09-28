import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";

// Reproduces a real staging operator failure: with
// MIGRATION_DATABASE_URL already defined (e.g. loaded from an env
// file), prefixing the runner with DATABASE_URL=... does NOT
// redirect it — MIGRATION_DATABASE_URL deliberately wins. These
// tests prove that precedence, the fallback, and the fail-fast exit
// against the real runner and a real database. The runner works on
// its own fresh database inside the ephemeral cluster so the shared
// integration fixtures are untouched.

const SCRIPT = path.join(process.cwd(), "scripts", "db", "apply-migrations.sh");
const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
// Unroutable fast-failing target: nothing listens on port 9.
const UNREACHABLE_URL = "postgres://nobody@127.0.0.1:9/nowhere";

let freshDbUrl: string;

function runScript(env: Record<string, string | undefined>) {
  const base = { ...process.env };
  delete base.MIGRATION_DATABASE_URL;
  delete base.DATABASE_URL;
  const result = spawnSync("bash", [SCRIPT], {
    env: { ...base, ...env },
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  const sql = getSql();
  await sql.unsafe("drop database if exists migration_runner_test");
  await sql.unsafe("create database migration_runner_test");
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = "/migration_runner_test";
  freshDbUrl = url.toString();
});

afterAll(async () => {
  await closeSql();
});

describe("apply-migrations.sh variable precedence and fail-fast", () => {
  const migrationCount = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length;

  it("uses MIGRATION_DATABASE_URL even when DATABASE_URL is also set", () => {
    const { status, output } = runScript({
      MIGRATION_DATABASE_URL: freshDbUrl,
      DATABASE_URL: UNREACHABLE_URL,
    });
    expect(output).toContain("connecting via: MIGRATION_DATABASE_URL");
    expect(output).toContain(`${migrationCount} applied, 0 already recorded`);
    expect(status).toBe(0);
  });

  it("re-run skips every recorded file (falling back to DATABASE_URL when the migration variable is unset)", () => {
    const { status, output } = runScript({ DATABASE_URL: freshDbUrl });
    expect(output).toContain("connecting via: DATABASE_URL (fallback");
    expect(output).toContain(`0 applied, ${migrationCount} already recorded`);
    expect(status).toBe(0);
  });

  it("a DATABASE_URL prefix does not override a bad MIGRATION_DATABASE_URL: the run fails fast", () => {
    const { status, output } = runScript({
      MIGRATION_DATABASE_URL: UNREACHABLE_URL,
      DATABASE_URL: freshDbUrl,
    });
    expect(output).toContain("connecting via: MIGRATION_DATABASE_URL");
    expect(status).not.toBe(0);
    // No secret leakage in output either way.
    expect(output).not.toContain("nobody");
  });
});
