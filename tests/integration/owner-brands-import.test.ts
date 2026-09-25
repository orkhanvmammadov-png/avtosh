import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  parseCatalogImportFile,
  runCatalogImport,
} from "../../scripts/catalog/import.mts";
import { IMPORT_PATH } from "../../scripts/catalog/generate-owner-brands.mts";

// The integration database is shared across test files and other
// fixtures insert real slugs (toyota, bmw, yamaha) non-idempotently,
// so this suite only DRY-RUNS the owner file: it proves the real data
// file validates and resolves against the live schema and seeded
// categories without persisting anything. Import mechanics themselves
// are covered by catalog-import.test.ts.

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

describe("owner brand catalog file against the real schema", () => {
  it("dry-run imports all 210 brands with their category links", async () => {
    const sql = getSql();
    const data = parseCatalogImportFile(
      JSON.parse(readFileSync(IMPORT_PATH, "utf8")),
    );
    const summary = await runCatalogImport(sql, data, { dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.brands).toBe(210);
    expect(summary.brandCategoryLinks).toBe(222); // 158 CAR + 64 MOTORCYCLE
    // Nothing persisted: a distinctive owner-only brand must not exist.
    const rows = await sql`select 1 from brands where slug = 'abarth'`;
    expect(rows.length).toBe(0);
  });
});
