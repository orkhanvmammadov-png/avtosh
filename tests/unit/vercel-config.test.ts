import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Vercel Functions stay pinned to Frankfurt (fra1), colocated with
// the eu-central-1 Supabase database, and the cron configuration is
// pinned to exactly the five approved schedules (runbook §10). Every
// job endpoint is double-gated at runtime: READ_ONLY refuses even a
// valid CRON_SECRET, and without CRON_SECRET nothing is executable —
// deploying these schedules does NOT run jobs until both gates open.

const config = JSON.parse(
  readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
) as Record<string, unknown>;

describe("vercel.json production configuration", () => {
  it("pins functions to exactly the fra1 region", () => {
    expect(config.regions).toEqual(["fra1"]);
  });

  it("schedules exactly the five approved cron jobs", () => {
    // Minute offsets STAGGER the jobs so cron invocations never all
    // align on the quarter hour — simultaneous function instances
    // were a multiplier in the session-pool exhaustion incident.
    expect(config.crons).toEqual([
      { path: "/api/jobs/reconcile-payments", schedule: "*/5 * * * *" },
      { path: "/api/jobs/send-reminders", schedule: "3-59/10 * * * *" },
      { path: "/api/jobs/expire-listings", schedule: "7-59/15 * * * *" },
      { path: "/api/jobs/promotion-housekeeping", schedule: "11-59/15 * * * *" },
      { path: "/api/jobs/cleanup-images", schedule: "23 */6 * * *" },
    ]);
  });

  it("carries no other keys that could change scheduling or routing", () => {
    expect(Object.keys(config).sort()).toEqual(["crons", "regions"]);
  });
});
