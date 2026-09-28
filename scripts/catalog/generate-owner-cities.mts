/**
 * Deterministic generator for the owner city catalog files.
 *
 *   node scripts/catalog/generate-owner-cities.mts [--check]
 *
 * Reads the immutable owner city source (TSV, exactly 72 rows in the
 * Owner's display order) at
 * data/catalog/source/AVTOSH_owner_city_source.tsv and emits:
 *
 *   data/catalog/owner-cities.json      importer-format `cities`:
 *     name_az byte-exact (Azerbaijani characters preserved), a stable
 *     unique ASCII slug, is_active=true, and sort_order following the
 *     Owner's file order (1..72). Slugs for rows that already exist in
 *     local environments (Bakı → baki, Gəncə → gence) come out of the
 *     same transliteration, so the importer's slug-keyed upsert
 *     preserves their UUIDs and listing references.
 *   data/catalog/owner-cities-provenance.json  every source row with
 *     its numeric source_option_value (an external source key, never
 *     the cities.id UUID) mapped to the generated slug.
 *
 * Output is byte-deterministic; `--check` verifies the committed
 * files. Standalone by design (no "@/..." imports), like import.mts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const CITY_SOURCE_PATH = path.join(
  ROOT,
  "data/catalog/source/AVTOSH_owner_city_source.tsv",
);
export const CITIES_PATH = path.join(ROOT, "data/catalog/owner-cities.json");
export const CITY_PROVENANCE_PATH = path.join(
  ROOT,
  "data/catalog/owner-cities-provenance.json",
);

/** Sealed checksum of the authoritative owner source. */
export const CITY_SOURCE_SHA256 =
  "aeed546c8783eed0ac0db210da8305f76ad2a040905c7936d3ec2a5df6a9fbd1";

export interface CitySourceRow {
  line: number;
  source_option_value: string;
  name_az: string;
}

/** Azerbaijani → ASCII slug letters (Unicode NFKD cannot decompose
    ə/ı, so the mapping is explicit). */
const AZ_LETTERS: Record<string, string> = {
  ə: "e",
  Ə: "e",
  ı: "i",
  İ: "i",
  ğ: "g",
  Ğ: "g",
  ş: "s",
  Ş: "s",
  ç: "c",
  Ç: "c",
  ö: "o",
  Ö: "o",
  ü: "u",
  Ü: "u",
};

export function citySlug(name: string): string {
  const mapped = [...name].map((ch) => AZ_LETTERS[ch] ?? ch).join("");
  const slug = mapped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    throw new Error(`cannot derive a valid slug from city name: ${name}`);
  }
  return slug;
}

export function parseCitySource(raw: string): CitySourceRow[] {
  const lines = raw.split("\n");
  if (lines[0] !== "source_option_value\tname_az") {
    throw new Error("city source: unexpected header line");
  }
  const rows: CitySourceRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "") continue; // trailing newline only
    const parts = line.split("\t");
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || parts[1].trim() === "") {
      throw new Error(`city source: malformed row at line ${i + 1}`);
    }
    rows.push({ line: i + 1, source_option_value: parts[0], name_az: parts[1] });
  }
  if (rows.length !== 72) {
    throw new Error(`city source: expected exactly 72 rows, found ${rows.length}`);
  }
  return rows;
}

export function generateOwnerCityFiles(raw: string): {
  citiesFile: string;
  provenanceFile: string;
} {
  const digest = createHash("sha256").update(raw, "utf8").digest("hex");
  if (digest !== CITY_SOURCE_SHA256) {
    throw new Error(
      `city source checksum mismatch: ${digest} (expected ${CITY_SOURCE_SHA256})`,
    );
  }
  const rows = parseCitySource(raw);

  const values = new Set<string>();
  const names = new Set<string>();
  const slugs = new Set<string>();
  const cities = rows.map((row, index) => {
    if (values.has(row.source_option_value)) {
      throw new Error(`duplicate source_option_value: ${row.source_option_value}`);
    }
    if (names.has(row.name_az)) {
      throw new Error(`duplicate city name: ${row.name_az}`);
    }
    const slug = citySlug(row.name_az);
    if (slugs.has(slug)) {
      throw new Error(`city slug collision: ${slug} (${row.name_az})`);
    }
    values.add(row.source_option_value);
    names.add(row.name_az);
    slugs.add(slug);
    return {
      name_az: row.name_az,
      slug,
      is_active: true,
      sort_order: index + 1, // the Owner's display order is authoritative
    };
  });

  const citiesFile = `${JSON.stringify({ cities }, null, 2)}\n`;
  const provenanceFile = `${JSON.stringify(
    {
      title: "AVTOSH.AZ owner city source provenance",
      source_file: path.basename(CITY_SOURCE_PATH),
      source_sha256: CITY_SOURCE_SHA256,
      note:
        "source_option_value is the owner's external source key, not " +
        "the cities.id UUID; database identity is keyed by slug.",
      rows: rows.map((row, index) => ({
        source_option_value: row.source_option_value,
        name_az: row.name_az,
        slug: cities[index].slug,
        sort_order: index + 1,
      })),
    },
    null,
    2,
  )}\n`;
  return { citiesFile, provenanceFile };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (invokedDirectly) {
  const { citiesFile, provenanceFile } = generateOwnerCityFiles(
    readFileSync(CITY_SOURCE_PATH, "utf8"),
  );
  if (process.argv.includes("--check")) {
    for (const [file, expected] of [
      [CITIES_PATH, citiesFile],
      [CITY_PROVENANCE_PATH, provenanceFile],
    ] as const) {
      if (readFileSync(file, "utf8") !== expected) {
        console.error(`stale: ${path.relative(ROOT, file)} — re-run the generator`);
        process.exit(1);
      }
    }
    console.log("owner city files match the source");
  } else {
    writeFileSync(CITIES_PATH, citiesFile);
    writeFileSync(CITY_PROVENANCE_PATH, provenanceFile);
    console.log(`wrote ${path.relative(ROOT, CITIES_PATH)}`);
    console.log(`wrote ${path.relative(ROOT, CITY_PROVENANCE_PATH)}`);
  }
}
