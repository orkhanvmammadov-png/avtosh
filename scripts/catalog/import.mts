/**
 * Catalog data importer — see data/catalog/README.md for the format.
 *
 *   DATABASE_URL=postgres://... pnpm catalog:import <file.json> [--dry-run]
 *
 * Standalone by design (no "@/..." imports) so it runs directly under
 * Node's native TypeScript support without the Next.js runtime. It
 * validates the whole file first, verifies referenced categories and
 * brands, then upserts everything in one transaction keyed on stable
 * slugs/codes. Re-runs are idempotent; nothing is ever deleted —
 * deactivation happens via is_active. DATABASE_URL is never logged.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9-]{1,64}$/, "invalid slug");
const categoryCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/);

const importFileSchema = z.object({
  brands: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        slug,
        categories: z.array(categoryCode).min(1),
        is_active: z.boolean().default(true),
        sort_order: z.int().default(0),
      }),
    )
    .default([]),
  models: z
    .array(
      z.object({
        brand_slug: slug,
        category: categoryCode,
        name: z.string().min(1).max(100),
        slug,
        is_active: z.boolean().default(true),
        sort_order: z.int().default(0),
      }),
    )
    .default([]),
  cities: z
    .array(
      z.object({
        name_az: z.string().min(1).max(100),
        slug,
        is_active: z.boolean().default(true),
        sort_order: z.int().default(0),
      }),
    )
    .default([]),
  features: z
    .array(
      z.object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
        name_az: z.string().min(1).max(100),
        category: categoryCode.nullable().default(null),
        is_active: z.boolean().default(true),
        sort_order: z.int().default(0),
      }),
    )
    .default([]),
});

export type CatalogImportFile = z.infer<typeof importFileSchema>;

export interface ImportSummary {
  brands: number;
  brandCategoryLinks: number;
  models: number;
  cities: number;
  features: number;
  dryRun: boolean;
}

type Sql = ReturnType<typeof postgres>;

export function parseCatalogImportFile(raw: unknown): CatalogImportFile {
  const parsed = importFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Import file failed validation:\n${issues}`);
  }
  return parsed.data;
}

export async function runCatalogImport(
  sql: Sql,
  data: CatalogImportFile,
  options: { dryRun: boolean },
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    brands: 0,
    brandCategoryLinks: 0,
    models: 0,
    cities: 0,
    features: 0,
    dryRun: options.dryRun,
  };

  await sql.begin(async (tx) => {
    // Resolve and verify every referenced category code up front.
    const referencedCategories = new Set<string>([
      ...data.brands.flatMap((b) => b.categories),
      ...data.models.map((m) => m.category),
      ...data.features.flatMap((f) => (f.category === null ? [] : [f.category])),
    ]);
    const categoryIds = new Map<string, string>();
    for (const code of referencedCategories) {
      const rows = await tx<{ id: string }[]>`
        select id from categories where code = ${code}
      `;
      if (rows.length === 0) {
        throw new Error(`Unknown category code referenced: ${code}`);
      }
      categoryIds.set(code, rows[0].id);
    }

    for (const brand of data.brands) {
      await tx`
        insert into brands (name, slug, is_active, sort_order)
        values (${brand.name}, ${brand.slug}, ${brand.is_active}, ${brand.sort_order})
        on conflict (slug) do update
          set name = excluded.name,
              is_active = excluded.is_active,
              sort_order = excluded.sort_order
      `;
      summary.brands += 1;
      for (const code of brand.categories) {
        await tx`
          insert into brand_categories (brand_id, category_id)
          values (
            (select id from brands where slug = ${brand.slug}),
            ${categoryIds.get(code)!}
          )
          on conflict do nothing
        `;
        summary.brandCategoryLinks += 1;
      }
    }

    for (const model of data.models) {
      const brandRows = await tx<{ id: string }[]>`
        select id from brands where slug = ${model.brand_slug}
      `;
      if (brandRows.length === 0) {
        throw new Error(
          `Model "${model.slug}" references unknown brand slug: ${model.brand_slug}`,
        );
      }
      await tx`
        insert into models (brand_id, category_id, name, slug, is_active, sort_order)
        values (${brandRows[0].id}, ${categoryIds.get(model.category)!},
                ${model.name}, ${model.slug}, ${model.is_active}, ${model.sort_order})
        on conflict (brand_id, category_id, slug) do update
          set name = excluded.name,
              is_active = excluded.is_active,
              sort_order = excluded.sort_order
      `;
      summary.models += 1;
    }

    for (const city of data.cities) {
      await tx`
        insert into cities (name_az, slug, is_active, sort_order)
        values (${city.name_az}, ${city.slug}, ${city.is_active}, ${city.sort_order})
        on conflict (slug) do update
          set name_az = excluded.name_az,
              is_active = excluded.is_active,
              sort_order = excluded.sort_order
      `;
      summary.cities += 1;
    }

    for (const feature of data.features) {
      const featureCategoryId =
        feature.category === null ? null : categoryIds.get(feature.category)!;
      await tx`
        insert into features (code, name_az, category_id, is_active, sort_order)
        values (${feature.code}, ${feature.name_az}, ${featureCategoryId},
                ${feature.is_active}, ${feature.sort_order})
        on conflict (code) do update
          set name_az = excluded.name_az,
              category_id = excluded.category_id,
              is_active = excluded.is_active,
              sort_order = excluded.sort_order
      `;
      summary.features += 1;
    }

    if (options.dryRun) {
      // Abort the transaction: everything above is rolled back.
      throw new DryRunRollback(summary);
    }
  }).catch((error: unknown) => {
    if (error instanceof DryRunRollback) {
      return;
    }
    throw error;
  });

  return summary;
}

class DryRunRollback extends Error {
  readonly summary: ImportSummary;

  constructor(summary: ImportSummary) {
    super("dry-run rollback");
    this.summary = summary;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((arg) => !arg.startsWith("--"));
  if (file === undefined) {
    console.error(
      "Usage: DATABASE_URL=... pnpm catalog:import <file.json> [--dry-run]",
    );
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const data = parseCatalogImportFile(JSON.parse(readFileSync(file, "utf8")));
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const summary = await runCatalogImport(sql, data, { dryRun });
    console.log(
      `${dryRun ? "[dry-run] would apply" : "Applied"}: ` +
        `${summary.brands} brands, ${summary.brandCategoryLinks} brand/category links, ` +
        `${summary.models} models, ${summary.cities} cities, ${summary.features} features.`,
    );
  } finally {
    await sql.end();
  }
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
