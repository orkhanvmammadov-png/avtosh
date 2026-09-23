import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { listActivePromotionPackages } from "@/repositories/promotions";

/**
 * O.14 — the authoritative post-migration package catalog. The
 * migration chain itself must produce EXACTLY the Owner-approved
 * matrix: this file asserts it against raw rows, with no test-side
 * activation or seeding. It runs (alphabetically) before the
 * purchase suites that consume the catalog; earlier suites that
 * mutate packages restore their exact snapshot, so these assertions
 * hold for the shared database contract too.
 */

const ACTIVE_PREMIUM: [number, number][] = [
  [1, 300],
  [10, 1199],
  [21, 2199],
  [30, 3099],
];
const ACTIVE_BOOST: [number, number][] = [
  [3, 400],
  [7, 800],
  [10, 1100],
  [15, 1300],
];

interface PackageRow {
  type: string;
  name: string;
  duration_days: number;
  price_minor: string;
  currency: string;
  is_active: boolean;
  sort_order: number;
}

let rows: PackageRow[] = [];

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  const sql = getSql();
  rows = await sql<PackageRow[]>`
    select type::text as type, name, duration_days, price_minor::text as price_minor,
           currency, is_active, sort_order
    from promotion_packages
    order by type, sort_order, duration_days
  `;
});

afterAll(async () => {
  await closeSql();
});

describe("O.14 authoritative package matrix", () => {
  it("exactly 4 active PREMIUM packages with the Owner-approved durations and minor prices", () => {
    const active = rows.filter((r) => r.type === "PREMIUM" && r.is_active);
    expect(active).toHaveLength(4);
    expect(active.map((r) => [r.duration_days, Number(r.price_minor)])).toEqual(ACTIVE_PREMIUM);
    for (const r of active) expect(r.currency).toBe("AZN");
  });

  it("exactly 4 active BOOST packages with the Owner-approved durations and minor prices", () => {
    const active = rows.filter((r) => r.type === "BOOST" && r.is_active);
    expect(active).toHaveLength(4);
    expect(active.map((r) => [r.duration_days, Number(r.price_minor)])).toEqual(ACTIVE_BOOST);
    for (const r of active) expect(r.currency).toBe("AZN");
  });

  it("retired legacy identities remain present, inactive, and historically unchanged", () => {
    const retired = rows.filter((r) => !r.is_active);
    expect(
      retired.map((r) => `${r.type}:${r.duration_days}:${r.name}`).sort(),
    ).toEqual(["BOOST:1:Boost 1 gün", "PREMIUM:3:Premium 3 gün", "PREMIUM:7:Premium 7 gün"]);
    // original placeholder prices preserved — rows were never repriced
    // or repurposed into different durations
    const byKey = new Map(retired.map((r) => [`${r.type}:${r.duration_days}`, Number(r.price_minor)]));
    expect(byKey.get("PREMIUM:3")).toBe(700);
    expect(byKey.get("PREMIUM:7")).toBe(1200);
    expect(byKey.get("BOOST:1")).toBe(200);
  });

  it("no duplicate rows exist for any (type, duration) — including the O.14-introduced pairs", () => {
    // schema has no (type, duration_days) uniqueness; the migration's
    // NOT EXISTS guards are the only protection
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.type}:${r.duration_days}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, n] of counts) expect({ key, n }).toEqual({ key, n: 1 });
    for (const key of ["PREMIUM:10", "PREMIUM:21", "PREMIUM:30", "BOOST:10", "BOOST:15"]) {
      expect(counts.get(key)).toBe(1);
    }
    expect(rows).toHaveLength(11); // 8 active + 3 retired, nothing else
  });

  it("seller catalog order is deterministic per type: Premium 1/10/21/30, Boost 3/7/10/15", async () => {
    const dtoRows = await listActivePromotionPackages(getSql());
    const order = (type: string) =>
      dtoRows.filter((r) => r.type === type).map((r) => r.duration_days);
    expect(order("PREMIUM")).toEqual([1, 10, 21, 30]);
    expect(order("BOOST")).toEqual([3, 7, 10, 15]);
    // explicit sort_order carries the contract (never insertion order):
    // active rows 10..40 ascending per type, retired rows sort after
    for (const r of rows) {
      if (r.is_active) {
        expect(r.sort_order).toBeGreaterThanOrEqual(10);
        expect(r.sort_order).toBeLessThanOrEqual(40);
      } else {
        expect(r.sort_order).toBeGreaterThanOrEqual(100);
      }
    }
  });
});
