import { describe, expect, it } from "vitest";
import {
  brandsQuerySchema,
  featuresQuerySchema,
  modelsQuerySchema,
  optionsQuerySchema,
} from "@/validators/catalog";

describe("catalog query validators", () => {
  it("accepts a valid brands query", () => {
    expect(brandsQuerySchema.safeParse({ category: "CAR" }).success).toBe(true);
  });

  it("rejects lowercase or malformed category codes", () => {
    expect(brandsQuerySchema.safeParse({ category: "car" }).success).toBe(false);
    expect(brandsQuerySchema.safeParse({ category: "C AR" }).success).toBe(false);
    expect(brandsQuerySchema.safeParse({}).success).toBe(false);
  });

  it("requires a UUID brand_id for models", () => {
    expect(
      modelsQuerySchema.safeParse({
        category: "CAR",
        brand_id: "3f0e8f7a-58f4-4f5c-9d0e-0a9b8c7d6e5f",
      }).success,
    ).toBe(true);
    expect(
      modelsQuerySchema.safeParse({ category: "CAR", brand_id: "42" }).success,
    ).toBe(false);
    expect(modelsQuerySchema.safeParse({ category: "CAR" }).success).toBe(false);
  });

  it("validates option group codes and optional category", () => {
    expect(optionsQuerySchema.safeParse({ group: "FUEL_TYPE" }).success).toBe(
      true,
    );
    expect(
      optionsQuerySchema.safeParse({ group: "BODY_TYPE", category: "CAR" })
        .success,
    ).toBe(true);
    expect(optionsQuerySchema.safeParse({ group: "fuel type" }).success).toBe(
      false,
    );
    expect(optionsQuerySchema.safeParse({}).success).toBe(false);
  });

  it("allows features query with or without category", () => {
    expect(featuresQuerySchema.safeParse({}).success).toBe(true);
    expect(featuresQuerySchema.safeParse({ category: "MOTORCYCLE" }).success).toBe(
      true,
    );
    expect(featuresQuerySchema.safeParse({ category: "moto" }).success).toBe(
      false,
    );
  });
});
