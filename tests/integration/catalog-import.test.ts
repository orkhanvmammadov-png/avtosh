import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  parseCatalogImportFile,
  runCatalogImport,
  type CatalogImportFile,
} from "../../scripts/catalog/import.mts";

const examplePath = path.resolve(
  import.meta.dirname,
  "../../data/catalog/examples/sample-catalog.json",
);

// The integration test files share one ephemeral database, so this
// dataset uses imp-* slugs/codes that no other fixture touches.
function importData(): CatalogImportFile {
  return parseCatalogImportFile({
    brands: [
      { name: "Imp Lada", slug: "imp-lada", categories: ["CAR"] },
      {
        name: "Imp Ducati",
        slug: "imp-ducati",
        categories: ["MOTORCYCLE"],
      },
    ],
    models: [
      { brand_slug: "imp-lada", category: "CAR", name: "Niva", slug: "imp-niva" },
      {
        brand_slug: "imp-ducati",
        category: "MOTORCYCLE",
        name: "Monster",
        slug: "imp-monster",
      },
    ],
    cities: [{ name_az: "İmp Xırdalan", slug: "imp-xirdalan", sort_order: 50 }],
    features: [
      { code: "IMP_TEST_FEATURE", name_az: "İmp Testi", category: "CAR" },
    ],
  });
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set — run via: pnpm test:integration:db",
    );
  }
});

afterAll(async () => {
  await closeSql();
});

describe("catalog importer", () => {
  it("accepts the documented example file", () => {
    const parsed = parseCatalogImportFile(
      JSON.parse(readFileSync(examplePath, "utf8")),
    );
    expect(parsed.brands.length).toBeGreaterThan(0);
  });

  it("rejects an invalid file before any write", () => {
    expect(() =>
      parseCatalogImportFile({ brands: [{ name: "X", slug: "BAD SLUG" }] }),
    ).toThrow(/validation/);
  });

  it("dry-run reports work without persisting", async () => {
    const sql = getSql();
    const summary = await runCatalogImport(sql, importData(), {
      dryRun: true,
    });
    expect(summary.brands).toBe(2);
    expect(summary.dryRun).toBe(true);
    const rows = await sql`select 1 from brands where slug = 'imp-lada'`;
    expect(rows.length).toBe(0);
  });

  it("imports the dataset and is idempotent on re-run", async () => {
    const sql = getSql();
    await runCatalogImport(sql, importData(), { dryRun: false });
    await runCatalogImport(sql, importData(), { dryRun: false });

    const brands = await sql`
      select slug from brands where slug like 'imp-%' order by slug
    `;
    expect(brands.map((b) => b.slug)).toEqual(["imp-ducati", "imp-lada"]);
    const models = await sql`select 1 from models where slug like 'imp-%'`;
    expect(models.length).toBe(2);
    const cities = await sql`select 1 from cities where slug = 'imp-xirdalan'`;
    expect(cities.length).toBe(1);
    const features = await sql`
      select 1 from features where code = 'IMP_TEST_FEATURE'
    `;
    expect(features.length).toBe(1);
  });

  it("updates activation instead of deleting", async () => {
    const sql = getSql();
    const data = importData();
    data.brands[0].is_active = false; // imp-lada
    await runCatalogImport(sql, data, { dryRun: false });
    const [lada] = await sql<{ is_active: boolean }[]>`
      select is_active from brands where slug = 'imp-lada'
    `;
    expect(lada.is_active).toBe(false);
    const models = await sql`
      select 1 from models
      where brand_id = (select id from brands where slug = 'imp-lada')
    `;
    expect(models.length).toBe(1); // model retained, nothing deleted
  });

  it("aborts entirely on an unknown category reference", async () => {
    const sql = getSql();
    const data = importData();
    data.cities.push({
      name_az: "İmp Şəki",
      slug: "imp-seki",
      is_active: true,
      sort_order: 51,
    });
    data.models.push({
      brand_slug: "imp-lada",
      category: "SPACESHIP",
      name: "Starship",
      slug: "imp-starship",
      is_active: true,
      sort_order: 9,
    });
    await expect(
      runCatalogImport(sql, data, { dryRun: false }),
    ).rejects.toThrow(/Unknown category/);
    const rows = await sql`select 1 from cities where slug = 'imp-seki'`;
    expect(rows.length).toBe(0); // transactional: nothing applied
  });
});
