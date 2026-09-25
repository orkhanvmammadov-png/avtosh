import { describe, expect, it } from "vitest";
import { correctionEntryStage, deriveResumeStage } from "@/lib/seller/journey";
import type { OwnerListingDto } from "@/services/listing-dto";

/** Minimal DTO factory — only the fields the pure helpers read. */
function dto(overrides: Partial<OwnerListingDto> = {}): OwnerListingDto {
  return {
    id: "l1",
    publicId: "1",
    status: "DRAFT",
    revision: 1,
    category: "CAR",
    brandId: "b",
    modelId: "m",
    modelVariantId: null,
    year: 2021,
    priceMinor: null,
    currency: "AZN",
    mileage: null,
    engineCc: null,
    fuelTypeId: null,
    transmissionId: null,
    bodyTypeId: null,
    driveTypeId: null,
    motorcycleTypeId: null,
    colorId: null,
    cityId: null,
    creditAvailable: false,
    noAccident: null,
    notRepainted: null,
    barterAvailable: false,
    description: null,
    contactPhone: null,
    sellerName: null,
    premiumIntentPackageId: null,
    boostIntentPackageId: null,
    featureIds: [],
    images: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const image = { id: "i", sortOrder: 0, isPrimary: true, width: 1, height: 1, mimeType: "image/webp", url: null };
const sale = { priceMinor: 100000, mileage: 1000, cityId: "c" } as const;

describe("deriveResumeStage — O.10 restore matrix", () => {
  it("incomplete Quick Start identity → quickstart", () => {
    expect(deriveResumeStage(dto({ brandId: null }))).toBe("quickstart");
    expect(deriveResumeStage(dto({ modelId: null }))).toBe("quickstart");
    expect(deriveResumeStage(dto({ year: null }))).toBe("quickstart");
  });

  it("CASE A — fresh post-Quick-Start draft (identity only) → details, for CAR and MOTORCYCLE", () => {
    expect(deriveResumeStage(dto())).toBe("details");
    expect(deriveResumeStage(dto({ category: "MOTORCYCLE" }))).toBe("details");
    // optional Detallar data alone does NOT change freshness handling:
    // engine/fuel etc. are not scanned — the draft still resumes at
    // the first unmet required gate
    expect(deriveResumeStage(dto({ engineCc: 1600 }))).toBe("details");
  });

  it("CASE B — valid sale, no photos → photos", () => {
    expect(deriveResumeStage(dto({ ...sale }))).toBe("photos");
  });

  it("CASE C — valid sale, 2 confirmed photos → photos", () => {
    expect(deriveResumeStage(dto({ ...sale, images: [image, { ...image, id: "i2" }] }))).toBe("photos");
  });

  it("partial sale data resumes at sale (required gate not ready)", () => {
    expect(deriveResumeStage(dto({ priceMinor: 100000 }))).toBe("sale");
  });

  it("CASE D — 3+ photos, seller name missing → infoContact", () => {
    const images = [image, { ...image, id: "i2" }, { ...image, id: "i3" }];
    expect(deriveResumeStage(dto({ ...sale, images, contactPhone: "+994501234567" }))).toBe("infoContact");
    expect(deriveResumeStage(dto({ ...sale, images, sellerName: "Ad" }))).toBe("infoContact");
  });

  it("CASE E — every required gate ready → review", () => {
    const images = [image, { ...image, id: "i2" }, { ...image, id: "i3" }];
    expect(
      deriveResumeStage(dto({ ...sale, images, sellerName: "Ad", contactPhone: "+994501234567" })),
    ).toBe("review");
  });

  it("CASE F — manual backward position is NOT an input: derivation is a pure function of data", () => {
    // identical data ⇒ identical resume, regardless of where the
    // seller last stood in the UI (accepted, documented limitation)
    const a = dto({ ...sale, images: [image, { ...image, id: "i2" }, { ...image, id: "i3" }], sellerName: "Ad", contactPhone: "+994501234567" });
    expect(deriveResumeStage(a)).toBe(deriveResumeStage({ ...a }));
    expect(deriveResumeStage(a)).toBe("review");
  });
});

describe("correctionEntryStage — honest reason mapping", () => {
  it("maps the four precise reason codes", () => {
    expect(correctionEntryStage("INVALID_PHOTOS")).toBe("photos");
    expect(correctionEntryStage("SUSPICIOUS_PRICE")).toBe("sale");
    expect(correctionEntryStage("CONTACT_ISSUE")).toBe("infoContact");
    expect(correctionEntryStage("WRONG_CATEGORY")).toBe("quickstart");
  });

  it("ambiguous codes fall back to review — never a guessed section", () => {
    for (const code of ["MISLEADING_INFO", "INCOMPLETE_INFO", "DUPLICATE_LISTING", "PROHIBITED_ITEM", "OTHER"]) {
      expect(correctionEntryStage(code)).toBe("review");
    }
  });

  it("null and unknown codes fall back to review without throwing", () => {
    expect(correctionEntryStage(null)).toBe("review");
    expect(correctionEntryStage("FUTURE_UNKNOWN_CODE")).toBe("review");
  });
});
