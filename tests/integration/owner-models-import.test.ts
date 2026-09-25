import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  parseCatalogImportFile,
  runCatalogImport,
} from "../../scripts/catalog/import.mts";
import { IMPORT_PATH as BRANDS_PATH } from "../../scripts/catalog/generate-owner-brands.mts";
import { MODELS_PATH } from "../../scripts/catalog/generate-owner-models.mts";

// The COMPLETE owner set (210 brands + 1658 model families + 694
// variants) is dry-run as ONE import against the live schema: every
// row must resolve and be writable, and nothing may persist (the
// shared integration database has non-idempotent fixtures on real
// slugs). Import mechanics themselves are covered by
// catalog-import.test.ts.

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

describe("owner model catalog file against the real schema", () => {
  it("dry-run imports the complete brand+model+variant set together", async () => {
    const sql = getSql();
    const brands = JSON.parse(readFileSync(BRANDS_PATH, "utf8")) as Record<string, unknown>;
    const models = JSON.parse(readFileSync(MODELS_PATH, "utf8")) as Record<string, unknown>;
    const data = parseCatalogImportFile({ ...brands, ...models });
    const summary = await runCatalogImport(sql, data, { dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.brands).toBe(210);
    expect(summary.brandCategoryLinks).toBe(222);
    expect(summary.models).toBe(1658);
    expect(summary.modelVariants).toBe(694);
    const rows = await sql`select 1 from brands where slug = 'abarth'`;
    expect(rows.length).toBe(0); // nothing persisted
  });
});
