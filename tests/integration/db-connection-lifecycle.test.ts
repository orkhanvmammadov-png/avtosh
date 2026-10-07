import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { GET as brandsRoute } from "@/app/api/v1/catalog/brands/route";
import { GET as searchRoute } from "@/app/api/v1/listings/route";
import { GET as citiesRoute } from "@/app/api/v1/catalog/cities/route";

/**
 * Connection-lifecycle regression for the EMAXCONNSESSION incident:
 * one instance's pool must never exceed its configured ceiling, no
 * matter how many requests run concurrently — the exhaustion vector
 * is INSTANCE fan-out, not per-instance leakage, and this pins the
 * per-instance half of that invariant against a real database using
 * the application_name tag the fix introduces.
 */

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
});

afterAll(async () => {
  await closeSql();
});

describe("per-instance pool ceiling under concurrent load", () => {
  it("a 30-request burst across routes keeps distinct backend connections within the pool max", async () => {
    const burst = [
      ...Array.from({ length: 10 }, () =>
        brandsRoute(new Request("http://localhost/api/v1/catalog/brands?category=CAR")),
      ),
      ...Array.from({ length: 10 }, () =>
        searchRoute(new Request("http://localhost/api/v1/listings?category=CAR")),
      ),
      ...Array.from({ length: 10 }, () =>
        citiesRoute(new Request("http://localhost/api/v1/catalog/cities")),
      ),
    ];
    const responses = await Promise.all(burst);
    for (const response of responses) expect(response.status).toBe(200);

    const sql = getSql();
    const max = sql.options.max;
    const [row] = await sql<{ active: string }[]>`
      select count(distinct pid)::text as active
      from pg_stat_activity
      where application_name = 'avtosh-runtime'
    `;
    const active = Number(row!.active);
    expect(active).toBeGreaterThan(0); // the tag is really applied
    expect(active).toBeLessThanOrEqual(max); // never exceeds the ceiling
  });
});
