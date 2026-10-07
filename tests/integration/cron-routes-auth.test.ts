import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeSql } from "@/lib/server/db/client";
import { GET as reconcileRoute } from "@/app/api/jobs/reconcile-payments/route";
import { GET as remindersRoute } from "@/app/api/jobs/send-reminders/route";
import { GET as expireRoute } from "@/app/api/jobs/expire-listings/route";
import { GET as promoRoute } from "@/app/api/jobs/promotion-housekeeping/route";
import { GET as imagesRoute } from "@/app/api/jobs/cleanup-images/route";

/**
 * Cron-restoration guard: deploying the vercel.json schedules only
 * makes Vercel CALL these endpoints — this matrix proves what the
 * calls can do. ALL FIVE jobs: refuse in READ_ONLY even with a valid
 * CRON_SECRET (schedules deployed ≠ jobs running), refuse a wrong or
 * missing secret in FULL, and execute idempotently in FULL with the
 * valid secret.
 */

const CRON_SECRET = "cron-matrix-test-secret-0001";

const JOBS: [string, (request: Request) => Promise<Response>][] = [
  ["reconcile-payments", reconcileRoute],
  ["send-reminders", remindersRoute],
  ["expire-listings", expireRoute],
  ["promotion-housekeeping", promoRoute],
  ["cleanup-images", imagesRoute],
];

function jobRequest(name: string, bearer?: string): Request {
  return new Request(`http://localhost/api/jobs/${name}`, {
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
  });
}

async function code(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  process.env.CRON_SECRET = CRON_SECRET;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  delete process.env.CRON_SECRET;
  await closeSql();
});

describe("all five scheduled jobs are double-gated", () => {
  it("READ_ONLY refuses every job even with the valid CRON_SECRET", async () => {
    vi.stubEnv("LAUNCH_MODE", "READ_ONLY");
    for (const [name, route] of JOBS) {
      const response = await route(jobRequest(name, CRON_SECRET));
      expect(response.status, name).toBe(503);
      expect(await code(response), name).toBe("SERVICE_READ_ONLY");
    }
  });

  it("FULL refuses a wrong and a missing bearer uniformly", async () => {
    for (const [name, route] of JOBS) {
      const wrong = await route(jobRequest(name, "not-the-secret-000000"));
      expect(wrong.status, name).toBe(401);
      const missing = await route(jobRequest(name));
      expect(missing.status, name).toBe(401);
    }
  });

  it("FULL + valid secret executes every job and re-runs are safe (idempotent summaries)", async () => {
    for (const [name, route] of JOBS) {
      const first = await route(jobRequest(name, CRON_SECRET));
      expect(first.status, name).toBe(200);
      const second = await route(jobRequest(name, CRON_SECRET));
      expect(second.status, `${name} re-run`).toBe(200);
    }
  });
});
