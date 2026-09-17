import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  parseCatalogImportFile,
  runCatalogImport,
  type CatalogImportFile,
} from "../../scripts/catalog/import.mts";

/**
 * O.11 Stage A — data-integrity coverage for the authoritative
 * 58-item CAR equipment catalog (data/catalog/o11-equipment.json).
 * The integration files share one ephemeral database, so live-table
 * assertions are scoped to the O.11 code set instead of raw counts.
 */

const catalogPath = path.resolve(import.meta.dirname, "../../data/catalog/o11-equipment.json");

const GROUP_ORDER = [
  "SAFETY",
  "DRIVER_ASSISTANCE",
  "PARKING_CAMERA",
  "COMFORT",
  "CLIMATE_INTERIOR",
  "MULTIMEDIA",
  "LIGHTING_EXTERIOR",
] as const;

const GROUP_SIZES: Record<(typeof GROUP_ORDER)[number], number> = {
  SAFETY: 8,
  DRIVER_ASSISTANCE: 10,
  PARKING_CAMERA: 5,
  COMFORT: 10,
  CLIMATE_INTERIOR: 7,
  MULTIMEDIA: 9,
  LIGHTING_EXTERIOR: 9,
};

const LEGACY_DEV_CODES = ["AIR_CONDITIONING", "LEATHER_SEATS", "PARKING_SENSOR"];

let catalog: CatalogImportFile;
let codes: string[];
let carCategoryId: string;
let motoCategoryId: string;

beforeAll(async () => {
  catalog = parseCatalogImportFile(JSON.parse(readFileSync(catalogPath, "utf8")));
  codes = catalog.features.map((f) => f.code);
  const sql = getSql();
  carCategoryId = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  motoCategoryId = (await sql<{ id: string }[]>`select id from categories where code = 'MOTORCYCLE'`)[0].id;
  await runCatalogImport(sql, catalog, { dryRun: false });
});

afterAll(async () => {
  await closeSql();
});

describe("authoritative catalog file", () => {
  it("contains exactly 58 unique, active, UPPER_SNAKE items", () => {
    expect(catalog.features).toHaveLength(58); // G scope
    expect(new Set(codes).size).toBe(58); // G — unique codes
    for (const f of catalog.features) {
      expect(f.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(f.is_active).toBe(true); // H — all active
      expect(f.group_code).not.toBeNull(); // I — every item grouped
    }
  });

  it("covers exactly the seven approved groups with the approved sizes", () => {
    const byGroup = new Map<string, number>();
    for (const f of catalog.features) {
      byGroup.set(f.group_code!, (byGroup.get(f.group_code!) ?? 0) + 1);
    }
    expect([...byGroup.keys()].sort()).toEqual([...GROUP_ORDER].sort()); // J
    for (const group of GROUP_ORDER) {
      expect(byGroup.get(group)).toBe(GROUP_SIZES[group]);
    }
  });

  it("orders deterministically: group base + item ordinal, file order == sort order", () => {
    for (const [g, group] of GROUP_ORDER.entries()) {
      const items = catalog.features.filter((f) => f.group_code === group);
      items.forEach((f, i) => {
        expect(f.sort_order).toBe((g + 1) * 100 + (i + 1)); // K + L
      });
    }
    const sorts = catalog.features.map((f) => f.sort_order);
    expect(sorts).toEqual([...sorts].sort((a, b) => a - b));
  });

  it("never includes the legacy dev-only sample codes", () => {
    for (const legacy of LEGACY_DEV_CODES) {
      expect(codes).not.toContain(legacy); // O
    }
  });

  it("scopes ABS globally and every other item to CAR", () => {
    for (const f of catalog.features) {
      expect(f.category).toBe(f.code === "ABS" ? null : "CAR");
    }
  });
});

describe("imported database state", () => {
  it("has exactly one ABS row with the approved metadata", async () => {
    const sql = getSql();
    const rows = await sql<
      { id: string; category_id: string | null; group_code: string | null; is_active: boolean; sort_order: number }[]
    >`select id, category_id, group_code, is_active, sort_order from features where code = 'ABS'`;
    expect(rows).toHaveLength(1); // A — exactly one ABS
    expect(rows[0].category_id).toBeNull(); // C
    expect(rows[0].group_code).toBe("SAFETY"); // D
    expect(rows[0].is_active).toBe(true);
    expect(rows[0].sort_order).toBe(101);
  });

  it("CAR sees all 58 O.11 items active; MOTORCYCLE sees only ABS", async () => {
    const sql = getSql();
    const car = await sql<{ code: string }[]>`
      select code from features
      where is_active and (category_id is null or category_id = ${carCategoryId})
        and code = any(${codes})
      order by sort_order
    `;
    expect(car.map((r) => r.code)).toEqual(codes); // E + L — full set, catalog order
    const moto = await sql<{ code: string }[]>`
      select code from features
      where is_active and (category_id is null or category_id = ${motoCategoryId})
        and code = any(${codes})
    `;
    expect(moto.map((r) => r.code)).toEqual(["ABS"]); // F
  });

  it("re-running the importer preserves every UUID (ABS included) and creates no duplicates", async () => {
    const sql = getSql();
    const before = await sql<{ code: string; id: string }[]>`
      select code, id from features where code = any(${codes}) order by code
    `;
    const absBefore = before.find((r) => r.code === "ABS")!.id;
    await runCatalogImport(sql, catalog, { dryRun: false }); // second run
    const after = await sql<{ code: string; id: string }[]>`
      select code, id from features where code = any(${codes}) order by code
    `;
    expect(after).toHaveLength(58); // N — no duplicates
    expect(after).toEqual(before); // B — every UUID stable
    expect(after.find((r) => r.code === "ABS")!.id).toBe(absBefore);
  });

  it("existing listing_features relations to ABS survive an importer re-run untouched", async () => {
    const sql = getSql();
    const absId = (await sql<{ id: string }[]>`select id from features where code = 'ABS'`)[0].id;
    const [owner] = await sql<{ id: string }[]>`
      insert into users (phone_e164, display_name) values ('+994501110061', 'O11 Test') returning id
    `;
    const [listing] = await sql<{ id: string }[]>`
      insert into listings (owner_id, category_id, status) values (${owner.id}, ${carCategoryId}, 'DRAFT') returning id
    `;
    await sql`insert into listing_features (listing_id, feature_id) values (${listing.id}, ${absId})`;

    await runCatalogImport(sql, catalog, { dryRun: false });

    const relations = await sql<{ feature_id: string }[]>`
      select feature_id from listing_features where listing_id = ${listing.id}
    `;
    expect(relations).toEqual([{ feature_id: absId }]); // M — relation intact, same UUID
    // catalog expansion never attaches equipment to listings on its own
    expect(relations).toHaveLength(1);
  });

  it("legacy dev-only rows stay out of the active O.11 CAR set once the dev hygiene update runs", async () => {
    const sql = getSql();
    // Hermetic: the shared integration DB may already carry these rows
    // ACTIVE (other fixtures seed them), so simulate a dev database and
    // the dev_catalog.sql hygiene statement inside one rolled-back
    // transaction — shared state is left untouched.
    class Rollback extends Error {}
    await sql
      .begin(async (tx) => {
        for (const code of LEGACY_DEV_CODES) {
          await tx`
            insert into features (code, name_az, category_id)
            values (${code}, ${code}, ${carCategoryId})
            on conflict (code) do nothing
          `;
        }
        // the exact hygiene mechanism dev_catalog.sql applies
        await tx`
          update features set is_active = false
          where code in ('AIR_CONDITIONING', 'LEATHER_SEATS', 'PARKING_SENSOR')
        `;
        const active = await tx<{ code: string }[]>`
          select code from features
          where is_active and (category_id is null or category_id = ${carCategoryId})
            and code = any(${[...codes, ...LEGACY_DEV_CODES]})
        `;
        expect(active.map((r) => r.code).sort()).toEqual([...codes].sort()); // O — exactly the 58
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });
});
