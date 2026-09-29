import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql } from "@/lib/server/db/client";
import { GET as citiesRoute } from "@/app/api/v1/catalog/cities/route";
import { GET as brandsRoute } from "@/app/api/v1/catalog/brands/route";

// Cold-start-shaped catalog reads against a real database: the pool
// is closed first so every burst begins with zero live connections
// (like a fresh serverless instance), then concurrent first requests
// must all succeed with identical payloads — no hangs, no
// cross-request mismatches — using the production client options
// (idle_timeout / max_lifetime / connect_timeout).

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
});

afterAll(async () => {
  await closeSql();
});

async function bodyOf(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  return await response.text();
}

describe("concurrent cold-like catalog reads", () => {
  it("cities: 10 concurrent first reads on a fresh pool succeed identically", async () => {
    await closeSql();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => citiesRoute(new Request("http://localhost/api/v1/catalog/cities"))),
    );
    const bodies = await Promise.all(responses.map(bodyOf));
    for (const body of bodies) expect(body).toBe(bodies[0]);
    const parsed = JSON.parse(bodies[0]!) as { data: unknown[] };
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  it("brands: 10 concurrent first reads on a fresh pool succeed identically", async () => {
    await closeSql();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        brandsRoute(new Request("http://localhost/api/v1/catalog/brands?category=CAR")),
      ),
    );
    const bodies = await Promise.all(responses.map(bodyOf));
    for (const body of bodies) expect(body).toBe(bodies[0]);
    const parsed = JSON.parse(bodies[0]!) as { data: unknown[] };
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data.length).toBeGreaterThan(0);
  });
});
