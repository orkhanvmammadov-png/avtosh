import { describe, expect, it } from "vitest";
import {
  generateOtpCode,
  generateSessionToken,
  hashIp,
  hashOtp,
  hashSessionToken,
  verifyOtpHash,
} from "@/auth/otp-crypto";

const PEPPER = "unit-test-pepper-0123456789abcdef";

describe("generateOtpCode", () => {
  it("produces 6 numeric digits", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateOtpCode()).toMatch(/^[0-9]{6}$/);
    }
  });
});

describe("hashOtp / verifyOtpHash", () => {
  it("verifies the correct code", () => {
    const hash = hashOtp(PEPPER, "challenge-1", "123456");
    expect(verifyOtpHash(PEPPER, "challenge-1", "123456", hash)).toBe(true);
  });

  it("rejects a wrong code", () => {
    const hash = hashOtp(PEPPER, "challenge-1", "123456");
    expect(verifyOtpHash(PEPPER, "challenge-1", "123457", hash)).toBe(false);
  });

  it("binds the hash to the challenge", () => {
    const hash = hashOtp(PEPPER, "challenge-1", "123456");
    expect(verifyOtpHash(PEPPER, "challenge-2", "123456", hash)).toBe(false);
  });

  it("binds the hash to the pepper", () => {
    const hash = hashOtp(PEPPER, "challenge-1", "123456");
    expect(verifyOtpHash("other-pepper-0123456789", "challenge-1", "123456", hash)).toBe(
      false,
    );
  });

  it("never stores the plaintext code in the hash", () => {
    expect(hashOtp(PEPPER, "challenge-1", "123456")).not.toContain("123456");
  });
});

describe("session tokens", () => {
  it("generates high-entropy unique tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(42); // 32 bytes base64url
  });

  it("hashes tokens to a fixed-length digest that hides the token", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });
});

describe("hashIp", () => {
  it("is deterministic per pepper and never contains the raw IP", () => {
    const a = hashIp(PEPPER, "203.0.113.7");
    expect(a).toBe(hashIp(PEPPER, "203.0.113.7"));
    expect(a).not.toContain("203");
    expect(hashIp("other-pepper-0123456789", "203.0.113.7")).not.toBe(a);
  });
});
