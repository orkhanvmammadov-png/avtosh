import { afterEach, describe, expect, it, vi } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";

// Per-instance pool ceiling: env-tunable, validated, defaulting to 5.
// The pool is created lazily and never connects in these tests.

afterEach(async () => {
  await closeSql();
  vi.unstubAllEnvs();
});

describe("DB_POOL_MAX", () => {
  it("defaults to 5 connections per instance", () => {
    vi.stubEnv("DATABASE_URL", "postgres://unit@127.0.0.1:1/unit");
    expect(getSql().options.max).toBe(5);
  });

  it("honors a valid override", () => {
    vi.stubEnv("DATABASE_URL", "postgres://unit@127.0.0.1:1/unit");
    vi.stubEnv("DB_POOL_MAX", "3");
    expect(getSql().options.max).toBe(3);
  });

  it("rejects out-of-range or non-integer values instead of guessing", () => {
    vi.stubEnv("DATABASE_URL", "postgres://unit@127.0.0.1:1/unit");
    for (const bad of ["0", "21", "2.5", "five", "-1"]) {
      vi.stubEnv("DB_POOL_MAX", bad);
      expect(() => getSql(), bad).toThrow(/DB_POOL_MAX/);
    }
  });

  it("tags connections with the application name for pg_stat_activity attribution", () => {
    vi.stubEnv("DATABASE_URL", "postgres://unit@127.0.0.1:1/unit");
    expect(
      (getSql().options.connection as { application_name?: string }).application_name,
    ).toBe("avtosh-runtime");
  });
});
