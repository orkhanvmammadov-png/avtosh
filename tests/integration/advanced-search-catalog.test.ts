import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { getReferenceOptions } from "@/services/catalog";

/**
 * Phase 4.17O.2B — owner-approved catalog reference data. Stable ids
 * preserved, renames are display-only, new options present, color
 * order + swatch metadata exact, condition columns default NULL.
 */

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
});

afterAll(async () => {
  await closeSql();
});

describe("fuel catalog", () => {
  it("keeps stable codes and shows the approved labels in order", async () => {
    const options = await getReferenceOptions("FUEL_TYPE");
    expect(options.map((o) => o.name)).toEqual([
      "Benzin", "Dizel", "Qaz", "Hidrogen", "Elektro", "Hibrid", "Plug-İn Hibrid", "Dizel-Hibrid",
    ]);
    const byCode = Object.fromEntries(options.map((o) => [o.code, o.name]));
    expect(byCode.ELECTRIC).toBe("Elektro"); // rename, same code
    expect(byCode.HYBRID).toBe("Hibrid"); // untouched — never reinterpreted
    expect(byCode.HYDROGEN).toBe("Hidrogen");
    expect(byCode.PLUGIN_HYBRID).toBe("Plug-İn Hibrid");
    expect(byCode.DIESEL_HYBRID).toBe("Dizel-Hibrid");
  });
});

describe("transmission catalog", () => {
  it("keeps stable codes: AUTOMATIC displays as Avtomat (AT) per owner decision", async () => {
    const options = await getReferenceOptions("TRANSMISSION");
    expect(options.map((o) => o.name)).toEqual([
      "Avtomat (DHT)", "Avtomat (AT)", "Avtomatik (Robot)", "Avtomat (Reduktor)", "Mexaniki (MT)", "Avtomat (Variator)",
    ]);
    const byCode = Object.fromEntries(options.map((o) => [o.code, o.name]));
    expect(byCode.AUTOMATIC).toBe("Avtomat (AT)");
    expect(byCode.MANUAL).toBe("Mexaniki (MT)");
    expect(byCode.ROBOT).toBe("Avtomatik (Robot)");
    expect(byCode.CVT).toBe("Avtomat (Variator)");
    expect(byCode.DHT).toBe("Avtomat (DHT)");
    expect(byCode.REDUCER).toBe("Avtomat (Reduktor)");
  });
});

describe("color catalog", () => {
  it("matches the approved 20-color order with presentation swatches", async () => {
    const options = await getReferenceOptions("COLOR");
    expect(options.map((o) => o.name)).toEqual([
      "Qara", "Yaşıl Asfalt", "Boz", "Gümüşü", "Ağ", "Bej", "Tünd qırmızı", "Qırmızı", "Çəhrayı",
      "Narıncı", "Qızılı", "Sarı", "Xaki", "Tünd yaşıl", "Yaşıl", "Açıq Yaşıl", "Mavi", "Göy",
      "Bənövşəyi", "Qəhvəyi",
    ]);
    const byName = Object.fromEntries(options.map((o) => [o.name, o.swatch]));
    expect(byName["Qara"]).toBe("#1B1E24");
    expect(byName["Ağ"]).toBe("#FFFFFF");
    expect(byName["Yaşıl Asfalt"]).toBe("#3D4A43");
    expect(byName["Qəhvəyi"]).toBe("#6D4C33");
    for (const option of options) {
      expect(option.swatch).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("kept the 12 pre-existing color ids stable (no re-keying)", async () => {
    const sql = getSql();
    const rows = await sql<{ code: string }[]>`
      select code from reference_options
      where group_code = 'COLOR' and code in
        ('BLACK','GRAY','SILVER','WHITE','BEIGE','RED','ORANGE','YELLOW','GREEN','BLUE','PURPLE','BROWN')
        and is_active`;
    expect(rows).toHaveLength(12);
  });
});

describe("condition columns", () => {
  it("exist as nullable booleans defaulting to NULL (no backfill)", async () => {
    const sql = getSql();
    const cols = await sql<{ column_name: string; is_nullable: string; column_default: string | null }[]>`
      select column_name, is_nullable, column_default
      from information_schema.columns
      where table_name = 'listings' and column_name in ('no_accident', 'not_repainted')`;
    expect(cols).toHaveLength(2);
    for (const col of cols) {
      expect(col.is_nullable).toBe("YES");
      expect(col.column_default).toBeNull();
    }
  });
});
