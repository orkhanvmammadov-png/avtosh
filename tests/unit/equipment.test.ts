import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_GROUPS,
  equipmentMatches,
  groupEquipment,
  normalizeEquipmentText,
} from "@/lib/marketplace/equipment";

describe("normalizeEquipmentText — deterministic AZ folding", () => {
  it("lowercases with the az locale (İ→i, I→ı→i)", () => {
    expect(normalizeEquipmentText("ISOFIX")).toBe("isofix");
    expect(normalizeEquipmentText("İşıq")).toBe("isiq");
  });

  it("folds Azerbaijani letters onto ASCII", () => {
    expect(normalizeEquipmentText("Təhlükəsizlik")).toBe("tehlukesizlik");
    expect(normalizeEquipmentText("görüntü")).toBe("goruntu");
    expect(normalizeEquipmentText("Yağış sensoru")).toBe("yagis sensoru");
  });

  it("trims and collapses whitespace", () => {
    expect(normalizeEquipmentText("  Apple   CarPlay  ")).toBe("apple carplay");
  });

  it("handles empty and non-letter input sensibly", () => {
    expect(normalizeEquipmentText("")).toBe("");
    expect(normalizeEquipmentText("   ")).toBe("");
    expect(normalizeEquipmentText("360° kamera")).toBe("360° kamera");
  });
});

describe("equipmentMatches — label search", () => {
  it("matches case-insensitively: CarPlay / carplay", () => {
    expect(equipmentMatches("Apple CarPlay", "CarPlay")).toBe(true);
    expect(equipmentMatches("Apple CarPlay", "carplay")).toBe(true);
  });

  it("ASCII query finds AZ labels", () => {
    expect(equipmentMatches("Arxa görüntü kamerası", "goruntu")).toBe(true);
    expect(equipmentMatches("Arxa görüntü kamerası", "kamera")).toBe(true);
    expect(equipmentMatches("Ön oturacaqların isidilməsi", "oturacaq")).toBe(true);
    expect(equipmentMatches("ISOFIX", "isofix")).toBe(true);
  });

  it("AZ query still matches AZ labels", () => {
    expect(equipmentMatches("Arxa görüntü kamerası", "görüntü")).toBe(true);
    expect(equipmentMatches("Təkər təzyiqinə nəzarət sistemi (TPMS)", "təzyiq")).toBe(true);
  });

  it("empty/whitespace query matches nothing (search inactive)", () => {
    expect(equipmentMatches("ABS", "")).toBe(false);
    expect(equipmentMatches("ABS", "   ")).toBe(false);
  });

  it("non-matching query stays false", () => {
    expect(equipmentMatches("ABS", "kamera")).toBe(false);
  });
});

describe("groupEquipment — approved order and fallback", () => {
  const item = (id: string, group: string | null) => ({ id, name: id, group });

  it("keeps the approved seven-group order, omitting empty groups", () => {
    const items = [item("a", "MULTIMEDIA"), item("b", "SAFETY"), item("c", "COMFORT")];
    expect(groupEquipment(items).map((g) => g.code)).toEqual(["SAFETY", "COMFORT", "MULTIMEDIA"]);
  });

  it("MOTO ABS-only catalog yields a single Təhlükəsizlik group", () => {
    const groups = groupEquipment([item("abs", "SAFETY")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Təhlükəsizlik");
  });

  it("null/unknown groups fall into a trailing Digər bucket only when present", () => {
    const groups = groupEquipment([item("a", "SAFETY"), item("b", null), item("c", "SOMETHING_NEW")]);
    expect(groups.map((g) => g.label)).toEqual(["Təhlükəsizlik", "Digər"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["b", "c"]);
    // and never when all items are grouped
    expect(groupEquipment([item("a", "SAFETY")]).some((g) => g.label === "Digər")).toBe(false);
  });

  it("exposes exactly the seven approved labels in order", () => {
    expect(EQUIPMENT_GROUPS.map((g) => g.label)).toEqual([
      "Təhlükəsizlik",
      "Sürücü köməkçiləri",
      "Park və kameralar",
      "Komfort",
      "Klimat və interyer",
      "Multimedia və texnologiya",
      "İşıq və eksteryer",
    ]);
  });
});
