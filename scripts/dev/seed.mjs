// Local DEVELOPMENT catalog bootstrap — the one documented step after
// migrations:
//
//   DATABASE_URL=postgres://... pnpm db:seed:dev
//
// Applies supabase/seed/dev_catalog.sql (small brand/model/city sample,
// idempotent) and then the AUTHORITATIVE O.11 equipment catalog
// (data/catalog/o11-equipment.json) through the real importer — the
// same single source of truth the E2E and UAT seeds consume. No second
// catalog copy, no manual follow-up import. Development only: never
// part of migrations or production deployment (production catalog data
// still arrives via `pnpm catalog:import` with verified sources).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { parseCatalogImportFile, runCatalogImport } from "../catalog/import.mts";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === "") {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

await sql.file(fileURLToPath(new URL("../../supabase/seed/dev_catalog.sql", import.meta.url)));

const o11 = parseCatalogImportFile(
  JSON.parse(readFileSync(new URL("../../data/catalog/o11-equipment.json", import.meta.url), "utf8")),
);
const summary = await runCatalogImport(sql, o11, { dryRun: false });
await sql.end();
console.log(`[dev-seed] sample catalog applied; O.11 equipment upserted (${summary.features} features)`);
