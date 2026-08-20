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
