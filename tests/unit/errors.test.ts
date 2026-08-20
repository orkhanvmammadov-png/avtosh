import { describe, expect, it } from "vitest";
import { ApiError, isApiError, toSafeApiError } from "@/lib/api/errors";

describe("ApiError", () => {
  it("uses the default status for its code", () => {
    expect(new ApiError("VALIDATION_ERROR", "Invalid input").status).toBe(400);
    expect(new ApiError("INTERNAL_ERROR", "Oops").status).toBe(500);
  });

  it("allows a status override and details", () => {
    const error = new ApiError("VALIDATION_ERROR", "Invalid", {
      status: 422,
      details: { field: "price" },
    });
    expect(error.status).toBe(422);
    expect(error.details).toEqual({ field: "price" });
  });
});

describe("toSafeApiError", () => {
  it("passes ApiError through unchanged", () => {
    const original = new ApiError("VALIDATION_ERROR", "Invalid input");
    expect(toSafeApiError(original)).toBe(original);
  });

  it("collapses unknown errors without leaking their message", () => {
    const leaky = new Error("connection to db at 10.0.0.5 failed: password=x");
    const safe = toSafeApiError(leaky);
    expect(safe.code).toBe("INTERNAL_ERROR");
    expect(safe.status).toBe(500);
    expect(safe.message).not.toContain("password");
    expect(safe.message).not.toContain("10.0.0.5");
  });

  it("handles non-Error values", () => {
    expect(isApiError(toSafeApiError("boom"))).toBe(true);
  });
});
