import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import {
  computeAdjustmentDelta,
  normalizeImagePlan,
} from "@/services/moderation-adjustments";
import type { SubmittedImageSnapshot } from "@/repositories/moderation-adjustments";

/** O.13 Stage B — pure image-plan validation and audit-delta rules. */

function snap(id: string, order: number, primary = false): SubmittedImageSnapshot {
  return {
    source_id: id,
    storage_path: `listings/${id}.webp`,
    sort_order: order,
    is_primary: primary,
    width: 1600,
    height: 900,
    mime_type: "image/webp",
  };
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const D = "44444444-4444-4444-4444-444444444444";
const SUBMITTED = [snap(A, 0, true), snap(B, 1), snap(C, 2), snap(D, 3)];

describe("normalizeImagePlan", () => {
  it("accepts a full valid plan and assigns deterministic order", () => {
    const plan = normalizeImagePlan(
      [
        { source_id: B, removed: false, is_primary: true },
        { source_id: A, removed: false, is_primary: false },
        { source_id: D, removed: true, is_primary: false },
        { source_id: C, removed: false, is_primary: false },
      ],
      SUBMITTED,
      3,
    );
    expect(plan.map((entry) => entry.sort_order)).toEqual([0, 1, 2, 3]);
    expect(plan[0]).toEqual({ source_id: B, removed: false, sort_order: 0, is_primary: true });
  });

  it("rejects unknown/injected sources — client storage identities carry no authority", () => {
    expect(() =>
      normalizeImagePlan(
        [
          { source_id: "99999999-9999-9999-9999-999999999999", removed: false, is_primary: true },
          { source_id: A, removed: false, is_primary: false },
          { source_id: B, removed: false, is_primary: false },
          { source_id: C, removed: false, is_primary: false },
          { source_id: D, removed: false, is_primary: false },
        ],
        SUBMITTED,
        3,
      ),
    ).toThrowError(ApiError);
  });

  it("rejects duplicates, partial coverage, removed primary, multi/no primary, below-min", () => {
    const full = (overrides: Partial<Record<"aPrimary" | "bPrimary", boolean>> = {}) => [
      { source_id: A, removed: false, is_primary: overrides.aPrimary ?? true },
      { source_id: B, removed: false, is_primary: overrides.bPrimary ?? false },
      { source_id: C, removed: false, is_primary: false },
      { source_id: D, removed: false, is_primary: false },
    ];
    // duplicate
    expect(() =>
      normalizeImagePlan([...full().slice(0, 3), { source_id: A, removed: false, is_primary: false }], SUBMITTED, 3),
    ).toThrowError(/Duplicate/);
    // partial coverage (one submitted image missing from the plan)
    expect(() => normalizeImagePlan(full().slice(0, 3), SUBMITTED, 3)).toThrowError(/cover every/);
    // removed primary
    expect(() =>
      normalizeImagePlan(
        [{ source_id: A, removed: true, is_primary: true }, ...full().slice(1)],
        SUBMITTED,
        3,
      ),
    ).toThrowError(/removed image/);
    // two primaries
    expect(() => normalizeImagePlan(full({ bPrimary: true }), SUBMITTED, 3)).toThrowError(/Exactly one/);
    // no primary
    expect(() => normalizeImagePlan(full({ aPrimary: false }), SUBMITTED, 3)).toThrowError(/Exactly one/);
    // below minimum kept
    const twoKept = [
      { source_id: A, removed: false, is_primary: true },
      { source_id: B, removed: false, is_primary: false },
      { source_id: C, removed: true, is_primary: false },
      { source_id: D, removed: true, is_primary: false },
    ];
    try {
      normalizeImagePlan(twoKept, SUBMITTED, 3);
      expect.unreachable("min-count plan must be rejected");
    } catch (error) {
      expect((error as ApiError).code).toBe("LISTING_INSUFFICIENT_IMAGES");
    }
  });
});

describe("computeAdjustmentDelta", () => {
  const plan = normalizeImagePlan(
    [
      { source_id: A, removed: false, is_primary: true },
      { source_id: B, removed: false, is_primary: false },
      { source_id: C, removed: false, is_primary: false },
      { source_id: D, removed: false, is_primary: false },
    ],
    SUBMITTED,
    3,
  );

  it("lists changed content keys deterministically (sorted), including cleared keys", () => {
    expect(
      computeAdjustmentDelta(
        { data: { price_minor: 100, brand_id: "x", city_id: "c" }, plan },
        { data: { price_minor: 200, brand_id: null, city_id: "c" }, plan },
      ),
    ).toEqual(["brand_id", "price_minor"]);
  });

  it("flags image_plan changes as one deterministic key", () => {
    const reordered = [plan[1], plan[0], plan[2], plan[3]].map((entry, index) => ({
      ...entry,
      sort_order: index,
    }));
    expect(
      computeAdjustmentDelta({ data: {}, plan }, { data: {}, plan: reordered }),
    ).toEqual(["image_plan"]);
  });

  it("returns an empty delta for identical states", () => {
    expect(computeAdjustmentDelta({ data: { a: 1 }, plan }, { data: { a: 1 }, plan })).toEqual([]);
  });
});
