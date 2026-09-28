import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The read-only launch ships with Vercel Functions pinned to
// Frankfurt (fra1), colocated with the eu-central-1 Supabase staging
// database, and with NO cron schedules — the scheduled jobs are
// restored only by the later reviewed FULL release (runbook §10).

const config = JSON.parse(
  readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
) as Record<string, unknown>;

describe("vercel.json read-only launch configuration", () => {
  it("pins functions to exactly the fra1 region", () => {
    expect(config.regions).toEqual(["fra1"]);
  });

  it("schedules no cron jobs in this release", () => {
    expect(config.crons).toEqual([]);
  });

  it("carries no other keys that could reintroduce scheduled work", () => {
    expect(Object.keys(config).sort()).toEqual(["crons", "regions"]);
  });
});
