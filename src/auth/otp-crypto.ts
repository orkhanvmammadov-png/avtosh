import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

/** 6-digit numeric OTP from CSPRNG (never Math.random). */
export function generateOtpCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}

/**
 * OTP storage hash. A 6-digit code has ~20 bits of entropy, so a
 * plain unsalted digest would be trivially brute-forced from a leaked
 * database. HMAC with a server-side pepper (never stored in the DB)
 * plus a challenge-bound canonical input makes offline brute force
 * infeasible and prevents cross-challenge hash reuse.
 */
export function hashOtp(
  pepper: string,
  challengeId: string,
  code: string,
): string {
  return createHmac("sha256", pepper)
    .update(`otp:v1:${challengeId}:${code}`)
    .digest("hex");
}

/** Constant-time OTP verification. */
export function verifyOtpHash(
  pepper: string,
  challengeId: string,
  code: string,
  storedHash: string,
): boolean {
  const computed = Buffer.from(hashOtp(pepper, challengeId, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (computed.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(computed, stored);
}

/**
 * Privacy-preserving IP key for rate limiting. Never store raw IPs;
 * the keyed hash cannot be reversed without the server pepper.
 */
export function hashIp(pepper: string, ip: string): string {
  return createHmac("sha256", pepper).update(`ip:v1:${ip}`).digest("hex");
}

/** 256-bit opaque session token. The browser cookie is its only home. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Session-token storage hash. The token is high-entropy random, so
 * unkeyed SHA-256 is sufficient for lookup storage — no pepper needed.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
