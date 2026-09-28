import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalogImportFile } from "../../scripts/catalog/import.mts";
import {
  CITIES_PATH,
  CITY_PROVENANCE_PATH,
  CITY_SOURCE_PATH,
  CITY_SOURCE_SHA256,
  citySlug,
  generateOwnerCityFiles,
  parseCitySource,
} from "../../scripts/catalog/generate-owner-cities.mts";

const sourceRaw = readFileSync(CITY_SOURCE_PATH, "utf8");
const citiesFile = JSON.parse(readFileSync(CITIES_PATH, "utf8")) as {
  cities: { name_az: string; slug: string; is_active: boolean; sort_order: number }[];
};
const provenance = JSON.parse(readFileSync(CITY_PROVENANCE_PATH, "utf8")) as {
  source_sha256: string;
  rows: { source_option_value: string; name_az: string; slug: string; sort_order: number }[];
};

describe("owner city catalog data", () => {
  it("the committed source matches the sealed SHA-256 and the generator enforces it", () => {
    const digest = createHash("sha256").update(sourceRaw, "utf8").digest("hex");
    expect(digest).toBe(CITY_SOURCE_SHA256);
    expect(provenance.source_sha256).toBe(CITY_SOURCE_SHA256);
    expect(() => generateOwnerCityFiles(`${sourceRaw}\ntampered\trow`)).toThrow(
      /checksum mismatch/,
    );
  });

  it("committed files are exactly what the generator produces from the source", () => {
    const generated = generateOwnerCityFiles(sourceRaw);
    expect(readFileSync(CITIES_PATH, "utf8")).toBe(generated.citiesFile);
    expect(readFileSync(CITY_PROVENANCE_PATH, "utf8")).toBe(generated.provenanceFile);
  });

  it("preserves all 72 names byte-exact in the Owner's order", () => {
    const rows = parseCitySource(sourceRaw);
    expect(rows).toHaveLength(72);
    expect(citiesFile.cities).toHaveLength(72);
    expect(provenance.rows).toHaveLength(72);
    rows.forEach((row, index) => {
      expect(citiesFile.cities[index].name_az).toBe(row.name_az);
      expect(citiesFile.cities[index].sort_order).toBe(index + 1);
      expect(provenance.rows[index].source_option_value).toBe(row.source_option_value);
    });
    // Azerbaijani characters survive untouched.
    const names = citiesFile.cities.map((c) => c.name_az);
    for (const expected of ["Ağcabədi", "İsmayıllı", "Lənkəran", "Naxçıvan", "Şuşa", "Xırdalan"]) {
      expect(names).toContain(expected);
    }
  });

  it("derives stable unique slugs and keeps the seeded identities", () => {
    const slugs = citiesFile.cities.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(72);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]{1,64}$/);
    // Existing local rows keep their slug-keyed identity on upsert.
    expect(citiesFile.cities.find((c) => c.name_az === "Bakı")?.slug).toBe("baki");
    expect(citiesFile.cities.find((c) => c.name_az === "Gəncə")?.slug).toBe("gence");
    expect(citySlug("İmişli")).toBe("imisli");
    expect(citySlug("Şəmkir")).toBe("semkir");
  });

  it("passes the catalog importer's own validation as a cities-only file", () => {
    const parsed = parseCatalogImportFile(JSON.parse(readFileSync(CITIES_PATH, "utf8")));
    expect(parsed.cities).toHaveLength(72);
    expect(parsed.brands).toHaveLength(0);
    expect(parsed.models).toHaveLength(0);
  });

  it("rejects malformed source rows instead of skipping them", () => {
    expect(() => parseCitySource("source_option_value\tname_az\nbroken-row")).toThrow(
      /malformed row at line 2/,
    );
    expect(() => parseCitySource("wrong\theader\n1\tBakı")).toThrow(/unexpected header/);
  });
});
