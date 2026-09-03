import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhoneE164 } from "@/auth/phone";

describe("normalizePhoneE164", () => {
  it("keeps a valid E.164 Azerbaijan mobile number", () => {
    expect(normalizePhoneE164("+994501234567")).toBe("+994501234567");
  });

  it("normalizes common local formatting", () => {
    expect(normalizePhoneE164("050 123 45 67")).toBe("+994501234567");
    expect(normalizePhoneE164("0501234567")).toBe("+994501234567");
    expect(normalizePhoneE164("(050) 123-45-67")).toBe("+994501234567");
    expect(normalizePhoneE164("994501234567")).toBe("+994501234567");
  });

  it("accepts foreign numbers in full international form", () => {
    expect(normalizePhoneE164("+491701234567")).toBe("+491701234567");
  });

  it("canonicalizes every accepted Azerbaijani local variant to one E.164 value", () => {
    // Phase 4.17O.1 table — all variants are ONE phone identity.
    const variants = [
      "010 218 41 91",
      "0102184191",
      "010-218-41-91",
      "(010) 218 41 91",
      "+994 10 218 41 91",
      "+994102184191",
    ];
    for (const variant of variants) {
      expect(normalizePhoneE164(variant), variant).toBe("+994102184191");
    }
  });

  it("keeps rejecting the accepted non-AZ negative", () => {
    expect(normalizePhoneE164("+1202555")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164("12345")).toBeNull();
    expect(normalizePhoneE164("not-a-phone")).toBeNull();
    expect(normalizePhoneE164("+994")).toBeNull();
    expect(normalizePhoneE164("+99450123456789012345")).toBeNull();
  });
});

describe("maskPhone", () => {
  it("masks the middle of the number", () => {
    const masked = maskPhone("+994501234567");
    expect(masked).toBe("+994•••••••67");
    expect(masked).not.toContain("5012345");
  });
});
