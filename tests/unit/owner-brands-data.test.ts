import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalogImportFile } from "../../scripts/catalog/import.mts";
import {
  IMPORT_PATH,
  REVIEW_PATH,
  SLUG_OVERRIDES,
  SOURCE_PATH,
  generateOwnerBrandFiles,
  type OwnerBrand,
} from "../../scripts/catalog/generate-owner-brands.mts";

const sourceRaw = readFileSync(SOURCE_PATH, "utf8");
const source = JSON.parse(sourceRaw) as { brands: OwnerBrand[] };
const importFile = JSON.parse(readFileSync(IMPORT_PATH, "utf8")) as {
  brands: { name: string; slug: string; categories: string[] }[];
};
const reviewFile = JSON.parse(readFileSync(REVIEW_PATH, "utf8")) as {
  brands: OwnerBrand[];
};

describe("owner brand catalog data", () => {
  it("committed files are exactly what the generator produces from the source", () => {
    const generated = generateOwnerBrandFiles(sourceRaw);
    expect(readFileSync(IMPORT_PATH, "utf8")).toBe(generated.importFile);
    expect(readFileSync(REVIEW_PATH, "utf8")).toBe(generated.reviewFile);
  });

  it("imports all 210 owner rows and reports the 30 review flags separately", () => {
    expect(source.brands).toHaveLength(210);
    expect(importFile.brands).toHaveLength(210);
    expect(reviewFile.brands).toHaveLength(30);
  });

  it("keeps every brand name byte-identical to the owner source", () => {
    const sourceNames = new Map(source.brands.map((b) => [b.display_name, b]));
    expect(importFile.brands.length).toBe(sourceNames.size);
    for (const brand of importFile.brands) {
      expect(sourceNames.has(brand.name)).toBe(true);
    }
    for (const brand of reviewFile.brands) {
      expect(sourceNames.get(brand.display_name)).toEqual(brand);
    }
  });

  it("assigns each brand exactly its proposed categories", () => {
    const proposed = new Map(
      source.brands.map((b) => [b.display_name, [...b.proposed_categories].sort()]),
    );
    for (const brand of importFile.brands) {
      expect([...brand.categories].sort()).toEqual(proposed.get(brand.name));
    }
  });

  it("review report holds exactly the flagged rows, verbatim", () => {
    const flagged = source.brands.filter((b) => b.review_reason !== null);
    expect(reviewFile.brands).toHaveLength(flagged.length);
    for (const brand of reviewFile.brands) {
      expect(brand.review_reason).toBeTruthy();
    }
    const reported = new Set(reviewFile.brands.map((b) => b.display_name));
    for (const brand of flagged) {
      expect(reported.has(brand.display_name)).toBe(true);
    }
  });

  it("applies the reconciled identity slugs instead of name-derived ones", () => {
    const bySlug = new Map(importFile.brands.map((b) => [b.name, b.slug]));
    expect(SLUG_OVERRIDES).toEqual({
      Mercedes: "mercedes-benz",
      "Ssang Yong": "ssangyong",
      iCar: "icaur",
      Radar: "riddara",
      "Seres Aito": "aito",
    });
    for (const [name, slug] of Object.entries(SLUG_OVERRIDES)) {
      expect(bySlug.get(name)).toBe(slug);
    }
  });

  it("has unique, importer-valid slugs", () => {
    const slugs = importFile.brands.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9-]{1,64}$/);
    }
  });

  it("passes the catalog importer's own validation", () => {
    const parsed = parseCatalogImportFile(
      JSON.parse(readFileSync(IMPORT_PATH, "utf8")),
    );
    expect(parsed.brands).toHaveLength(210);
    expect(parsed.models).toHaveLength(0);
    expect(parsed.cities).toHaveLength(0);
    expect(parsed.features).toHaveLength(0);
  });

  it("matches the owner's expected per-category totals", () => {
    const car = importFile.brands.filter((b) => b.categories.includes("CAR"));
    const moto = importFile.brands.filter((b) => b.categories.includes("MOTORCYCLE"));
    const both = importFile.brands.filter((b) => b.categories.length === 2);
    expect(car).toHaveLength(158);
    expect(moto).toHaveLength(64);
    expect(both).toHaveLength(12);
  });
});
