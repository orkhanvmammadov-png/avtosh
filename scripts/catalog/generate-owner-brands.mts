/**
 * Deterministic generator for the owner brand catalog files.
 *
 *   node scripts/catalog/generate-owner-brands.mts [--check]
 *
 * Reads the owner brand mapping (status DRAFT_REVIEW) at
 * data/catalog/source/AVTOSH_owner_brand_category_map.json and emits:
 *
 *   data/catalog/owner-brands.json          importer-format file with
 *     ALL rows (exact names, stable slugs, proposed categories only —
 *     no models, cities or features)
 *   data/catalog/owner-brands-review-pending.json  the review-flagged
 *     rows, verbatim: research QA notes recorded during category
 *     mapping, still open under Product review. Flagged brands are
 *     included in the import file. The importer accepts this file
 *     technically; the production gate is authorization — no
 *     production import has been authorized or performed.
 *
 * Output is byte-deterministic (sorted by name, stable key order), so
 * `--check` can verify the committed files match the source exactly.
 * Standalone by design (no "@/..." imports), like import.mts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const CATEGORY_CODES = ["CAR", "MOTORCYCLE"] as const;

const ownerBrandSchema = z
  .object({
    source_option_value: z.string().min(1),
    display_name: z.string().min(1).max(100),
    proposed_categories: z.array(z.enum(CATEGORY_CODES)).min(1),
    review_reason: z.string().min(1).nullable(),
    evidence_urls: z.array(z.string()),
  })
  .strict();

const ownerMapSchema = z
  .object({
    title: z.string(),
    status: z.string(),
    source_file: z.string(),
    rules: z.array(z.string()),
    brands: z.array(ownerBrandSchema).min(1),
  })
  .strict();

export type OwnerBrand = z.infer<typeof ownerBrandSchema>;

const ROOT = path.resolve(import.meta.dirname, "../..");
export const SOURCE_PATH = path.join(
  ROOT,
  "data/catalog/source/AVTOSH_owner_brand_category_map.json",
);
export const IMPORT_PATH = path.join(ROOT, "data/catalog/owner-brands.json");
export const REVIEW_PATH = path.join(
  ROOT,
  "data/catalog/owner-brands-review-pending.json",
);

/**
 * Slugs are the importer's stable identity keys, so a display name
 * whose canonical identity differs from its spelling must NOT get a
 * name-derived slug. These overrides carry the reconciled identities:
 * Mercedes and Ssang Yong follow the sealed O.15 identity decisions
 * (canonical mercedes-benz; ssangyong as an identity separate from
 * KGM), and iCar/Radar/Seres Aito use the owner-designated identity
 * slugs (iCAUR, Riddara, AITO). Display names stay exactly as
 * supplied — only the slug is reconciled.
 */
export const SLUG_OVERRIDES: Readonly<Record<string, string>> = {
  Mercedes: "mercedes-benz",
  "Ssang Yong": "ssangyong",
  iCar: "icaur",
  Radar: "riddara",
  "Seres Aito": "aito",
};

/** ASCII-only kebab slug; the owner names are all plain ASCII. */
export function brandSlug(name: string): string {
  const override = SLUG_OVERRIDES[name];
  if (override !== undefined) return override;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    throw new Error(`cannot derive a valid slug from brand name: ${name}`);
  }
  return slug;
}

export function generateOwnerBrandFiles(sourceRaw: string): {
  importFile: string;
  reviewFile: string;
} {
  const source = ownerMapSchema.parse(JSON.parse(sourceRaw));

  const names = new Set<string>();
  const values = new Set<string>();
  for (const brand of source.brands) {
    if (names.has(brand.display_name.toLowerCase())) {
      throw new Error(`duplicate brand name in source: ${brand.display_name}`);
    }
    if (values.has(brand.source_option_value)) {
      throw new Error(
        `duplicate source_option_value in source: ${brand.source_option_value}`,
      );
    }
    names.add(brand.display_name.toLowerCase());
    values.add(brand.source_option_value);
  }

  const byName = (a: OwnerBrand, b: OwnerBrand) =>
    a.display_name.localeCompare(b.display_name, "en");
  const all = [...source.brands].sort(byName);
  const flagged = source.brands.filter((b) => b.review_reason !== null).sort(byName);

  for (const overridden of Object.keys(SLUG_OVERRIDES)) {
    if (!all.some((b) => b.display_name === overridden)) {
      throw new Error(`slug override for absent brand: ${overridden}`);
    }
  }

  const slugs = new Set<string>();
  const importBrands = all.map((brand) => {
    const slug = brandSlug(brand.display_name);
    if (slugs.has(slug)) {
      throw new Error(`slug collision: ${slug}`);
    }
    slugs.add(slug);
    return {
      name: brand.display_name,
      slug,
      categories: [...brand.proposed_categories].sort(),
      is_active: true,
      sort_order: 0,
    };
  });

  const importFile = `${JSON.stringify({ brands: importBrands }, null, 2)}\n`;
  const reviewFile = `${JSON.stringify(
    {
      title: "Brand mapping rows with open research QA notes",
      status: "PRODUCT_REVIEW_PENDING",
      source_file: path.basename(SOURCE_PATH),
      note:
        "These rows carry a review_reason: research QA notes added " +
        "during category mapping (mapping status DRAFT_REVIEW). They " +
        "are not exclusions — the brands are included in " +
        "data/catalog/owner-brands.json. Owner UAT PASS covers the " +
        "displayed brand selections only; it does not resolve these " +
        "notes, and manufacturer identity and vehicle-form " +
        "compatibility have not been externally verified. No " +
        "production import has been authorized or performed.",
      brands: flagged,
    },
    null,
    2,
  )}\n`;
  return { importFile, reviewFile };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (invokedDirectly) {
  const { importFile, reviewFile } = generateOwnerBrandFiles(
    readFileSync(SOURCE_PATH, "utf8"),
  );
  if (process.argv.includes("--check")) {
    for (const [file, expected] of [
      [IMPORT_PATH, importFile],
      [REVIEW_PATH, reviewFile],
    ] as const) {
      if (readFileSync(file, "utf8") !== expected) {
        console.error(`stale: ${path.relative(ROOT, file)} — re-run the generator`);
        process.exit(1);
      }
    }
    console.log("owner brand files match the source mapping");
  } else {
    writeFileSync(IMPORT_PATH, importFile);
    writeFileSync(REVIEW_PATH, reviewFile);
    console.log(`wrote ${path.relative(ROOT, IMPORT_PATH)}`);
    console.log(`wrote ${path.relative(ROOT, REVIEW_PATH)}`);
  }
}
