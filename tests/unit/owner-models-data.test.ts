import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalogImportFile } from "../../scripts/catalog/import.mts";
import {
  BRAND_MAP_PATH,
  MODELS_PATH,
  MODEL_SOURCE_PATH,
  PROVENANCE_PATH,
  generateOwnerModelFiles,
  parseModelSource,
  type ProvenanceRow,
} from "../../scripts/catalog/generate-owner-models.mts";

const sourceRaw = readFileSync(MODEL_SOURCE_PATH, "utf8");
const brandMapRaw = readFileSync(BRAND_MAP_PATH, "utf8");
const modelsFile = JSON.parse(readFileSync(MODELS_PATH, "utf8")) as {
  models: { brand_slug: string; category: string; name: string; slug: string }[];
  model_variants: {
    brand_slug: string;
    category: string;
    model_slug: string;
    name: string;
    slug: string;
  }[];
};
const provenance = (
  JSON.parse(readFileSync(PROVENANCE_PATH, "utf8")) as { rows: ProvenanceRow[] }
).rows;

describe("owner model catalog data", () => {
  it("committed files are exactly what the generator produces from the source", () => {
    const generated = generateOwnerModelFiles(sourceRaw, brandMapRaw);
    expect(readFileSync(MODELS_PATH, "utf8")).toBe(generated.modelsFile);
    expect(readFileSync(PROVENANCE_PATH, "utf8")).toBe(generated.provenanceFile);
  });

  it("preserves every source row: 2352 options → 1658 families + 694 variants, none excluded", () => {
    const rows = parseModelSource(sourceRaw);
    expect(rows).toHaveLength(2352);
    expect(provenance).toHaveLength(2352);
    const roles = new Map<string, number>();
    for (const p of provenance) roles.set(p.role, (roles.get(p.role) ?? 0) + 1);
    expect(roles.get("family")).toBe(1658);
    expect(roles.get("variant")).toBe(694);
    expect(roles.get("excluded")).toBeUndefined();
    expect(modelsFile.models).toHaveLength(1658);
    expect(modelsFile.model_variants).toHaveLength(694);
    // Every source value appears exactly once in provenance.
    const sourceValues = new Set(rows.map((r) => r.source_value));
    const provValues = new Set(provenance.map((p) => p.source_value));
    expect(provValues.size).toBe(2352);
    expect([...sourceValues].filter((v) => !provValues.has(v))).toEqual([]);
  });

  it("keeps every model and variant label byte-identical to the source", () => {
    const labelByValue = new Map(
      parseModelSource(sourceRaw).map((r) => [r.source_value, r.label]),
    );
    for (const p of provenance) {
      expect(p.label).toBe(labelByValue.get(p.source_value));
    }
    // The importer-facing names are the same labels, never edited.
    const familyNames = new Set(
      provenance.filter((p) => p.role === "family").map((p) => `${p.brand_slug}|${p.category}|${p.label}`),
    );
    for (const model of modelsFile.models) {
      expect(familyNames.has(`${model.brand_slug}|${model.category}|${model.name}`)).toBe(true);
    }
  });

  it("keeps VL800 Intruder as a standalone Suzuki MOTORCYCLE family, never under Honda", () => {
    const vl = provenance.find((p) => p.source_value === "2322")!;
    expect(vl.role).toBe("family");
    expect(vl.brand_slug).toBe("suzuki");
    expect(vl.category).toBe("MOTORCYCLE");
    expect(vl.data_group).toBe("46"); // original malformed reference retained
    expect(vl.note).toMatch(/malformed data-group 46/);
    const model = modelsFile.models.find((m) => m.name === "VL800 Intruder")!;
    expect(model.brand_slug).toBe("suzuki");
    // No Honda variant carries the label.
    expect(
      modelsFile.model_variants.some(
        (v) => v.brand_slug === "honda" && v.name === "VL800 Intruder",
      ),
    ).toBe(false);
  });

  it("includes the five formerly excluded rows with documented provisional categories", () => {
    const provisional = provenance.filter((p) => p.category_basis === "PROVISIONAL_CATEGORY");
    expect(
      provisional.map((p) => [p.source_value, p.category] as const).sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual([
      ["2438", "MOTORCYCLE"], // Honda Today
      ["7183", "MOTORCYCLE"], // Dayun Yuehu
      ["8456", "CAR"], // Dayun Rehigh H8
      ["9510", "MOTORCYCLE"], // Jonway YY800-12
      ["9545", "MOTORCYCLE"], // Suzuki Amico 250
    ]);
    for (const p of provisional) {
      expect(p.role).toBe("family");
      expect(p.note).toMatch(/PROVISIONAL/);
    }
  });

  it("records a category basis for every shared-brand row and never copies a row into both categories", () => {
    for (const p of provenance) {
      expect([
        "BRAND_SINGLE_CATEGORY",
        "MOTO_GROUP",
        "SHARED_DEFAULT",
        "ROW_DECISION",
        "PROVISIONAL_CATEGORY",
      ]).toContain(p.category_basis);
    }
    // One source row → at most one imported row (family or variant).
    const importedKeys = [
      ...modelsFile.models.map((m) => `${m.brand_slug}|${m.category}|${m.slug}`),
      ...modelsFile.model_variants.map((v) => `${v.brand_slug}|${v.category}|${v.model_slug}|${v.slug}`),
    ];
    expect(new Set(importedKeys).size).toBe(importedKeys.length);
    expect(importedKeys.length).toBe(2352); // every source row imported
    // Triumph's one brand identity spans both categories via per-row decisions.
    const triumph = provenance.filter((p) => p.brand_slug === "triumph" && p.role !== "excluded");
    expect(triumph.map((p) => [p.label, p.category]).sort()).toEqual([
      ["Renown", "CAR"],
      ["Speed Triple RS", "MOTORCYCLE"],
      ["Spitfire", "CAR"],
    ]);
  });

  it("keeps every variant under a family of the same brand and category", () => {
    const families = new Map(
      modelsFile.models.map((m) => [`${m.brand_slug}|${m.category}|${m.slug}`, m]),
    );
    for (const v of modelsFile.model_variants) {
      expect(families.has(`${v.brand_slug}|${v.category}|${v.model_slug}`)).toBe(true);
    }
  });

  it("passes the catalog importer's own validation with valid unique slugs", () => {
    const parsed = parseCatalogImportFile(JSON.parse(readFileSync(MODELS_PATH, "utf8")));
    expect(parsed.models).toHaveLength(1658);
    expect(parsed.model_variants).toHaveLength(694);
    for (const m of modelsFile.models) expect(m.slug).toMatch(/^[a-z0-9-]{1,64}$/);
    for (const v of modelsFile.model_variants) expect(v.slug).toMatch(/^[a-z0-9-]{1,64}$/);
  });

  it("rejects a malformed option line instead of skipping it", () => {
    expect(() =>
      parseModelSource('Avtomobil & Moto Modelleri\n<option class="1" value="9">Broken</option>'),
    ).toThrow(/malformed option at line 2/);
  });
});
