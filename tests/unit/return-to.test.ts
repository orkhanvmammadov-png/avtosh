import { describe, expect, it } from "vitest";
import { sanitizeReturnTo } from "@/lib/security/return-to";

describe("sanitizeReturnTo", () => {
  it("accepts safe internal paths", () => {
    expect(sanitizeReturnTo("/profile")).toBe("/profile");
    expect(sanitizeReturnTo("/profile/listings")).toBe("/profile/listings");
    expect(sanitizeReturnTo("/elan/48291")).toBe("/elan/48291");
    expect(sanitizeReturnTo("/search?category=CAR&page=2")).toBe(
      "/search?category=CAR&page=2",
    );
  });

  it("returns null for missing values", () => {
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo(null)).toBeNull();
    expect(sanitizeReturnTo("")).toBeNull();
  });

  it("rejects absolute and scheme-relative URLs", () => {
    expect(sanitizeReturnTo("https://evil.example")).toBeNull();
    expect(sanitizeReturnTo("http://evil.example/x")).toBeNull();
    expect(sanitizeReturnTo("//evil.example")).toBeNull();
    expect(sanitizeReturnTo("//evil.example/path")).toBeNull();
  });

  it("rejects dangerous schemes", () => {
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeNull();
    expect(sanitizeReturnTo("data:text/html,x")).toBeNull();
    expect(sanitizeReturnTo("/x://evil.example")).toBeNull();
  });

  it("rejects backslash tricks", () => {
    expect(sanitizeReturnTo("/\\evil.example")).toBeNull();
    expect(sanitizeReturnTo("\\\\evil.example")).toBeNull();
    expect(sanitizeReturnTo("/a\\b")).toBeNull();
  });

  it("rejects encoded bypass attempts", () => {
    expect(sanitizeReturnTo("%2F%2Fevil.example")).toBeNull();
    expect(sanitizeReturnTo("/%2F%2Fevil.example")).toBeNull();
    expect(sanitizeReturnTo("/%5Cevil.example")).toBeNull();
    expect(sanitizeReturnTo("/x%3A%2F%2Fevil.example")).toBeNull();
    expect(sanitizeReturnTo("/%00")).toBeNull();
    expect(sanitizeReturnTo("/%")).toBeNull(); // malformed encoding
  });

  it("rejects control characters and whitespace", () => {
    expect(sanitizeReturnTo("/a\tb")).toBeNull();
    expect(sanitizeReturnTo("/a b")).toBeNull();
    expect(sanitizeReturnTo("/a\nb")).toBeNull();
  });

  it("rejects oversized values", () => {
    expect(sanitizeReturnTo(`/${"a".repeat(600)}`)).toBeNull();
  });
});
