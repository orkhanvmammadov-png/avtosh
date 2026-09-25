/**
 * Deterministic generator for the owner model/variant catalog files.
 *
 *   node scripts/catalog/generate-owner-models.mts [--check]
 *
 * Reads the immutable owner model source (an HTML <option> dump,
 * status DRAFT_REVIEW) at
 * data/catalog/source/AVTOSH_owner_model_source.md plus the approved
 * brand mapping, and emits:
 *
 *   data/catalog/owner-models.json       importer-format file:
 *     `models` (one per family: every value="groupN" row and every
 *     standalone row) and `model_variants` (one per data-group row).
 *   data/catalog/owner-models-provenance.json  every source option
 *     verbatim (value, class, data-group, data-count, label, line)
 *     with its resolution: brand slug, category + basis, role,
 *     generated slugs, and any anomaly note. Excluded rows appear
 *     here with role "excluded" and an explicit reason — nothing is
 *     silently skipped.
 *
 * Owner rules applied (see the PR description for provenance):
 * - Labels are preserved byte-exact; no editorial deduplication.
 * - `class` is the owner's numeric brand value, resolved through the
 *   210-brand mapping; it is provenance, not an AVTOSH id.
 * - Suzuki "VL800 Intruder" (value 2322, class 33) carries a
 *   malformed data-group="46" pointing at Honda Moto (class 12). The
 *   brand class is authoritative: it is imported as a STANDALONE
 *   Suzuki MOTORCYCLE family and the original reference is retained
 *   in provenance. It is never attached to Honda.
 * - Shared CAR+MOTORCYCLE brands keep one brand identity; each model
 *   row is assigned exactly one category via the decision table
 *   below. Rows whose category cannot be established are excluded
 *   and reported (never guessed, never copied into both categories).
 *
 * Output is byte-deterministic; `--check` verifies the committed
 * files. Standalone by design (no "@/..." imports), like import.mts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const MODEL_SOURCE_PATH = path.join(
  ROOT,
  "data/catalog/source/AVTOSH_owner_model_source.md",
);
export const BRAND_MAP_PATH = path.join(
  ROOT,
  "data/catalog/source/AVTOSH_owner_brand_category_map.json",
);
export const MODELS_PATH = path.join(ROOT, "data/catalog/owner-models.json");
export const PROVENANCE_PATH = path.join(
  ROOT,
  "data/catalog/owner-models-provenance.json",
);

/** Brand slugs must match the generator for owner-brands.json. */
const BRAND_SLUG_OVERRIDES: Readonly<Record<string, string>> = {
  Mercedes: "mercedes-benz",
  "Ssang Yong": "ssangyong",
  iCar: "icaur",
  Radar: "riddara",
  "Seres Aito": "aito",
};

/**
 * Category decisions for the 12 shared CAR+MOTORCYCLE brands, keyed
 * by the owner's numeric brand value (`class`). Single-category
 * brands never consult this table. Basis codes appear per-row in the
 * provenance file.
 */
export const MOTO_GROUP_IDS: ReadonlySet<string> = new Set([
  "47", // BMW Moto
  "46", // Honda Moto
  "45", // Suzuki Moto
  "49", // IJ Moto
  "254", // Lifan "Street bike"
]);

export const SHARED_BRAND_DEFAULTS: Readonly<Record<string, "CAR" | "MOTORCYCLE">> = {
  "3": "CAR", // BMW — car ranges are the default; Motorrad rows are exceptions
  "12": "CAR", // Honda
  "33": "CAR", // Suzuki
  "16": "CAR", // Peugeot — source contains only car models
  "64": "CAR", // IJ — 2717 van family; motorcycles live in IJ Moto
  "87": "CAR", // Lifan — sedans/SUVs; motorcycles live in "Street bike"
  "327": "MOTORCYCLE", // Bajaj — all rows are motorcycle lines (no Qute row)
  "141": "MOTORCYCLE", // KTM
  "144": "MOTORCYCLE", // Shineray
  "148": "MOTORCYCLE", // Dayun — DY* motorcycle codes
  // 233 Triumph and 235 Jonway intentionally have no default:
  // every row needs an explicit decision.
};

export type RowDecision =
  | { category: "CAR" | "MOTORCYCLE"; note: string }
  | { unresolved: string };

export const SHARED_BRAND_ROW_DECISIONS: Readonly<Record<string, RowDecision>> = {
  // BMW standalone Motorrad models (not members of BMW Moto):
  "9318": { category: "MOTORCYCLE", note: "BMW Motorrad F 900 GS" },
  "9320": { category: "MOTORCYCLE", note: "BMW Motorrad M 1000 R" },
  "9307": { category: "MOTORCYCLE", note: "BMW Motorrad R1300GS" },
  "9319": { category: "MOTORCYCLE", note: "BMW Motorrad S 1000 XR" },
  // Honda:
  "9419": { category: "MOTORCYCLE", note: "Honda Ruckus is a scooter line" },
  "2438": {
    unresolved:
      "Honda 'Today' names both a kei car and a scooter; the source row gives no category signal",
  },
  // Suzuki — owner ruling on the malformed reference:
  "2322": {
    category: "MOTORCYCLE",
    note:
      "VL800 Intruder: brand class 33 (Suzuki) is authoritative over the malformed data-group 46 (Honda Moto); imported as a standalone Suzuki MOTORCYCLE family",
  },
  "9545": {
    unresolved:
      "Suzuki 'Amico 250' matches no known Suzuki car or motorcycle line; category unverified",
  },
  // Dayun non-DY rows:
  "8456": {
    unresolved:
      "Dayun 'Rehigh H8' is likely the EV car line but the identity is unverified",
  },
  "7183": {
    unresolved:
      "Dayun 'Yuehu' is likely an electric two-wheeler but the identity is unverified",
  },
  // Jonway's single row:
  "9510": {
    unresolved:
      "Jonway 'YY800-12' does not match the documented YY scooter displacements; category unverified",
  },
  // Triumph — same name, two distinct histories, per-row decisions:
  "8961": { category: "CAR", note: "Triumph Renown — Triumph Motor Company saloon (1946–54)" },
  "4216": { category: "MOTORCYCLE", note: "Triumph Speed Triple RS — Triumph Motorcycles model" },
  "7272": { category: "CAR", note: "Triumph Spitfire — Triumph Motor Company sports car (1962–80)" },
};

export interface SourceRow {
  line: number;
  source_value: string;
  brand_class: string;
  data_group: string | null;
  data_count: number;
  label: string;
}

export interface ProvenanceRow extends SourceRow {
  brand_name: string;
  brand_slug: string;
  role: "family" | "variant" | "excluded";
  category: "CAR" | "MOTORCYCLE" | null;
  category_basis: string;
  model_slug: string | null;
  variant_slug: string | null;
  note: string | null;
}

const OPTION_RE =
  /^\s*<option class="(\d+)"(?: data-group="(\d+)")? data-count="(\d+)" value="((?:group)?\d+)">(.*)<\/option>\s*$/;

function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function parseModelSource(raw: string): SourceRow[] {
  const lines = raw.split("\n");
  if (lines[0] !== "Avtomobil & Moto Modelleri") {
    throw new Error("model source: unexpected header line");
  }
  const rows: SourceRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "" || line.trim() === "</select>") continue;
    const m = OPTION_RE.exec(line);
    if (m === null) {
      throw new Error(`model source: malformed option at line ${i + 1}`);
    }
    rows.push({
      line: i + 1,
      brand_class: m[1],
      data_group: m[2] ?? null,
      data_count: Number(m[3]),
      source_value: m[4],
      label: unescapeHtml(m[5]),
    });
  }
  return rows;
}

function slugify(label: string, fallback: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? `m-${fallback}` : slug.slice(0, 64);
}

interface BrandMapEntry {
  source_option_value: string;
  display_name: string;
  proposed_categories: ("CAR" | "MOTORCYCLE")[];
}

export function generateOwnerModelFiles(sourceRaw: string, brandMapRaw: string): {
  modelsFile: string;
  provenanceFile: string;
} {
  const rows = parseModelSource(sourceRaw);
  const brands = (JSON.parse(brandMapRaw) as { brands: BrandMapEntry[] }).brands;
  const brandByClass = new Map(brands.map((b) => [b.source_option_value, b]));

  const seenValues = new Set<string>();
  for (const row of rows) {
    if (seenValues.has(row.source_value)) {
      throw new Error(`duplicate source value: ${row.source_value}`);
    }
    seenValues.add(row.source_value);
  }

  const familyByGroupId = new Map<string, SourceRow>();
  for (const row of rows) {
    if (row.source_value.startsWith("group")) {
      familyByGroupId.set(row.source_value.slice(5), row);
    }
  }

  function resolveCategory(row: SourceRow): {
    category: "CAR" | "MOTORCYCLE" | null;
    basis: string;
    note: string | null;
  } {
    const brand = brandByClass.get(row.brand_class);
    if (brand === undefined) {
      throw new Error(`row ${row.source_value}: unknown brand class ${row.brand_class}`);
    }
    if (brand.proposed_categories.length === 1) {
      return { category: brand.proposed_categories[0], basis: "BRAND_SINGLE_CATEGORY", note: null };
    }
    const decision = SHARED_BRAND_ROW_DECISIONS[row.source_value];
    if (decision !== undefined) {
      if ("unresolved" in decision) {
        return { category: null, basis: "UNRESOLVED", note: decision.unresolved };
      }
      return { category: decision.category, basis: "ROW_DECISION", note: decision.note };
    }
    const groupId = row.source_value.startsWith("group")
      ? row.source_value.slice(5)
      : row.data_group;
    if (groupId !== null && MOTO_GROUP_IDS.has(groupId)) {
      return { category: "MOTORCYCLE", basis: "MOTO_GROUP", note: null };
    }
    const fallback = SHARED_BRAND_DEFAULTS[row.brand_class];
    if (fallback === undefined) {
      throw new Error(
        `row ${row.source_value} (${row.label}): shared brand class ${row.brand_class} has no default and no row decision`,
      );
    }
    return { category: fallback, basis: "SHARED_DEFAULT", note: null };
  }

  // First pass: resolve every row.
  const provenance: ProvenanceRow[] = [];
  const resolved = new Map<string, ProvenanceRow>();
  for (const row of rows) {
    const brand = brandByClass.get(row.brand_class)!;
    const brandSlug =
      BRAND_SLUG_OVERRIDES[brand.display_name] ?? slugify(brand.display_name, row.brand_class);
    const { category, basis, note } = resolveCategory(row);
    const isMalformedRef =
      row.data_group !== null &&
      familyByGroupId.get(row.data_group) !== undefined &&
      familyByGroupId.get(row.data_group)!.brand_class !== row.brand_class;
    const entry: ProvenanceRow = {
      ...row,
      brand_name: brand.display_name,
      brand_slug: brandSlug,
      role:
        category === null
          ? "excluded"
          : row.data_group !== null && !isMalformedRef
            ? "variant"
            : "family",
      category,
      category_basis: basis,
      model_slug: null,
      variant_slug: null,
      note:
        isMalformedRef && note === null
          ? `malformed parent reference data-group=${row.data_group} crosses brands; treated as standalone family`
          : note,
    };
    provenance.push(entry);
    resolved.set(row.source_value, entry);
  }

  // Orphan check: every variant's group must exist and share the brand class
  // (the VL800 case is already re-rolled to a family above).
  for (const entry of provenance) {
    if (entry.role !== "variant") continue;
    const family = familyByGroupId.get(entry.data_group!);
    if (family === undefined) {
      throw new Error(`variant ${entry.source_value}: no family row for group ${entry.data_group}`);
    }
    const familyEntry = resolved.get(family.source_value)!;
    if (familyEntry.role === "excluded") {
      throw new Error(
        `variant ${entry.source_value}: parent family ${family.source_value} is excluded`,
      );
    }
    if (familyEntry.category !== entry.category) {
      throw new Error(
        `variant ${entry.source_value}: category diverges from its family ${family.source_value}`,
      );
    }
  }

  // Second pass: deterministic slugs, unique per (brand, category) for
  // families and per family for variants. Collisions (equal labels from
  // distinct source ids) get a stable "-v<source_value>" suffix.
  const familySlugs = new Map<string, ProvenanceRow>();
  const families = provenance.filter((p) => p.role === "family");
  const byName = (a: ProvenanceRow, b: ProvenanceRow) =>
    a.label.localeCompare(b.label, "en") || a.source_value.localeCompare(b.source_value, "en");
  families.sort(byName);
  for (const fam of families) {
    const base = slugify(fam.label, fam.source_value);
    let slug = base;
    const scope = `${fam.brand_slug}/${fam.category}/`;
    if (familySlugs.has(scope + slug)) {
      const suffix = `-v${fam.source_value}`;
      slug = `${base.slice(0, 64 - suffix.length)}${suffix}`;
      if (familySlugs.has(scope + slug)) {
        throw new Error(`family slug collision beyond suffixing: ${scope + slug}`);
      }
      fam.note = fam.note ?? `slug disambiguated from equal label (source ${fam.source_value})`;
    }
    familySlugs.set(scope + slug, fam);
    fam.model_slug = slug;
  }
  const variantSlugs = new Set<string>();
  const variants = provenance.filter((p) => p.role === "variant");
  variants.sort(byName);
  for (const v of variants) {
    const family = resolved.get(familyByGroupId.get(v.data_group!)!.source_value)!;
    v.model_slug = family.model_slug;
    const base = slugify(v.label, v.source_value);
    let slug = base;
    const scope = `${v.brand_slug}/${v.category}/${family.model_slug}/`;
    if (variantSlugs.has(scope + slug)) {
      const suffix = `-v${v.source_value}`;
      slug = `${base.slice(0, 64 - suffix.length)}${suffix}`;
      if (variantSlugs.has(scope + slug)) {
        throw new Error(`variant slug collision beyond suffixing: ${scope + slug}`);
      }
      v.note = v.note ?? `slug disambiguated from equal label (source ${v.source_value})`;
    }
    variantSlugs.add(scope + slug);
    v.variant_slug = slug;
  }

  // DB-constraint preflight: models unique (brand, category, lower(name)),
  // variants unique (model, lower(name)). Equal-after-lower labels from
  // distinct ids must be reported, not silently merged or dropped.
  const nameKeys = new Map<string, string>();
  for (const fam of families) {
    const key = `${fam.brand_slug}/${fam.category}/${fam.label.toLowerCase()}`;
    const prior = nameKeys.get(key);
    if (prior !== undefined) {
      throw new Error(
        `family name collision under DB constraint: sources ${prior} and ${fam.source_value} (${fam.label})`,
      );
    }
    nameKeys.set(key, fam.source_value);
  }
  const variantNameKeys = new Map<string, string>();
  for (const v of variants) {
    const key = `${v.brand_slug}/${v.category}/${v.model_slug}/${v.label.toLowerCase()}`;
    const prior = variantNameKeys.get(key);
    if (prior !== undefined) {
      throw new Error(
        `variant name collision under DB constraint: sources ${prior} and ${v.source_value} (${v.label})`,
      );
    }
    variantNameKeys.set(key, v.source_value);
  }

  const modelsFile = `${JSON.stringify(
    {
      models: families.map((f) => ({
        brand_slug: f.brand_slug,
        category: f.category,
        name: f.label,
        slug: f.model_slug,
        is_active: true,
        sort_order: 0,
      })),
      model_variants: variants.map((v) => ({
        brand_slug: v.brand_slug,
        category: v.category,
        model_slug: v.model_slug,
        name: v.label,
        slug: v.variant_slug,
        is_active: true,
        sort_order: 0,
      })),
    },
    null,
    2,
  )}\n`;

  const provenanceSorted = [...provenance].sort((a, b) =>
    a.source_value.localeCompare(b.source_value, "en"),
  );
  const provenanceFile = `${JSON.stringify(
    {
      title: "AVTOSH.AZ owner model source provenance",
      status: "DRAFT_REVIEW",
      source_file: path.basename(MODEL_SOURCE_PATH),
      rows: provenanceSorted,
    },
    null,
    2,
  )}\n`;
  return { modelsFile, provenanceFile };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (invokedDirectly) {
  const { modelsFile, provenanceFile } = generateOwnerModelFiles(
    readFileSync(MODEL_SOURCE_PATH, "utf8"),
    readFileSync(BRAND_MAP_PATH, "utf8"),
  );
  if (process.argv.includes("--check")) {
    for (const [file, expected] of [
      [MODELS_PATH, modelsFile],
      [PROVENANCE_PATH, provenanceFile],
    ] as const) {
      if (readFileSync(file, "utf8") !== expected) {
        console.error(`stale: ${path.relative(ROOT, file)} — re-run the generator`);
        process.exit(1);
      }
    }
    console.log("owner model files match the source");
  } else {
    writeFileSync(MODELS_PATH, modelsFile);
    writeFileSync(PROVENANCE_PATH, provenanceFile);
    console.log(`wrote ${path.relative(ROOT, MODELS_PATH)}`);
    console.log(`wrote ${path.relative(ROOT, PROVENANCE_PATH)}`);
  }
}
