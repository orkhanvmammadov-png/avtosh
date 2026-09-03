import { describe, expect, it } from "vitest";
import {
  formatAzLocalPhoneInput,
  formatAzPhoneForDisplay,
} from "@/components/auth/phone-format";

/**
 * Phase 4.17O.1 — presentation-only phone helpers. These format the
 * VISIBLE value; canonicalization stays server-side in
 * normalizePhoneE164 (tests/unit/phone.test.ts).
 */

describe("formatAzLocalPhoneInput", () => {
  it("groups a full local number as 0XX XXX XX XX", () => {
    expect(formatAzLocalPhoneInput("0102184191")).toBe("010 218 41 91");
  });

  it("formats progressively while typing", () => {
    expect(formatAzLocalPhoneInput("0")).toBe("0");
    expect(formatAzLocalPhoneInput("010")).toBe("010");
    expect(formatAzLocalPhoneInput("0102")).toBe("010 2");
    expect(formatAzLocalPhoneInput("010218")).toBe("010 218");
    expect(formatAzLocalPhoneInput("01021841")).toBe("010 218 41");
    expect(formatAzLocalPhoneInput("010 218 41 91")).toBe("010 218 41 91");
  });

  it("cleans pasted separators", () => {
    expect(formatAzLocalPhoneInput("010-218-41-91")).toBe("010 218 41 91");
    expect(formatAzLocalPhoneInput("(010) 218 41 91")).toBe("010 218 41 91");
  });

  it("caps extra digits at the national length", () => {
    expect(formatAzLocalPhoneInput("010218419123")).toBe("010 218 41 91");
  });

  it("passes any international (+) input through untouched", () => {
    expect(formatAzLocalPhoneInput("+994102184191")).toBe("+994102184191");
    expect(formatAzLocalPhoneInput("+994 10 218 41 91")).toBe("+994 10 218 41 91");
    expect(formatAzLocalPhoneInput("+1202555")).toBe("+1202555");
  });
});

describe("formatAzPhoneForDisplay", () => {
  it("renders canonical E.164 AZ numbers in the local form", () => {
    expect(formatAzPhoneForDisplay("+994102184191")).toBe("010 218 41 91");
    expect(formatAzPhoneForDisplay("+994 10 218 41 91")).toBe("010 218 41 91");
  });

  it("renders local input in the grouped local form", () => {
    expect(formatAzPhoneForDisplay("0102184191")).toBe("010 218 41 91");
    expect(formatAzPhoneForDisplay("010 218 41 91")).toBe("010 218 41 91");
  });

  it("leaves non-AZ numbers exactly as entered", () => {
    expect(formatAzPhoneForDisplay("+491701234567")).toBe("+491701234567");
  });
});
