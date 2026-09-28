import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  parseCatalogImportFile,
  runCatalogImport,
} from "../../scripts/catalog/import.mts";
import { CITIES_PATH } from "../../scripts/catalog/generate-owner-cities.mts";

// The full 72-city owner file is DRY-RUN against the live schema
// (the shared integration database carries non-idempotent fixtures
// on real names/slugs), and identity preservation is proven with an
// oc-* namespaced fixture: the importer's slug-keyed upsert must
// keep the existing UUID while applying the owner's name and order.

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
});

afterAll(async () => {
  await closeSql();
});

describe("owner city catalog file against the real schema", () => {
  it("dry-run imports all 72 cities without persisting anything", async () => {
    const sql = getSql();
    const data = parseCatalogImportFile(JSON.parse(readFileSync(CITIES_PATH, "utf8")));
    const summary = await runCatalogImport(sql, data, { dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.cities).toBe(72);
    const rows = await sql`select 1 from cities where slug = 'agcabedi'`;
    expect(rows.length).toBe(0); // nothing persisted
  });

  it("slug-keyed upsert preserves an existing city UUID and is idempotent", async () => {
    const sql = getSql();
    const [existing] = await sql<{ id: string }[]>`
      insert into cities (name_az, slug, sort_order) values ('Oc Bakı', 'oc-baki', 99)
      returning id
    `;
    const data = parseCatalogImportFile({
      cities: [{ name_az: "Oc Bakı Yenilənmiş", slug: "oc-baki", sort_order: 7 }],
    });
    await runCatalogImport(sql, data, { dryRun: false });
    await runCatalogImport(sql, data, { dryRun: false }); // idempotent re-run
    const rows = await sql<{ id: string; name_az: string; sort_order: number }[]>`
      select id, name_az, sort_order from cities where slug = 'oc-baki'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id); // UUID (and FK references) preserved
    expect(rows[0].name_az).toBe("Oc Bakı Yenilənmiş");
    expect(rows[0].sort_order).toBe(7);
  });
});
