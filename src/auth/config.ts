import { z } from "zod";

/**
 * Validated auth configuration with sensible MVP defaults. Values are
 * read from the environment on every call (cheap) so tests can adjust
 * them; production deployments set only what they need to override.
 * These may migrate to system_settings/admin configuration later.
 */
const authEnvSchema = z.object({
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(45),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_MAX_RESENDS: z.coerce.number().int().min(0).default(3),
  OTP_PHONE_MAX_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_IP_MAX_PER_HOUR: z.coerce.number().int().positive().default(10),
  OTP_MIN_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(45),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  AUTH_SESSION_COOKIE_NAME: z.string().min(1).default("avtosh_session"),
});

export interface AuthConfig {
  otpTtlSeconds: number;
  otpResendCooldownSeconds: number;
  otpMaxAttempts: number;
  otpMaxResends: number;
  otpPhoneMaxPerHour: number;
  otpIpMaxPerHour: number;
  otpMinIntervalSeconds: number;
  sessionTtlSeconds: number;
  sessionCookieName: string;
}

export function authConfig(): AuthConfig {
  const parsed = authEnvSchema.parse({
    OTP_TTL_SECONDS: process.env.OTP_TTL_SECONDS,
    OTP_RESEND_COOLDOWN_SECONDS: process.env.OTP_RESEND_COOLDOWN_SECONDS,
    OTP_MAX_ATTEMPTS: process.env.OTP_MAX_ATTEMPTS,
    OTP_MAX_RESENDS: process.env.OTP_MAX_RESENDS,
    OTP_PHONE_MAX_PER_HOUR: process.env.OTP_PHONE_MAX_PER_HOUR,
    OTP_IP_MAX_PER_HOUR: process.env.OTP_IP_MAX_PER_HOUR,
    OTP_MIN_INTERVAL_SECONDS: process.env.OTP_MIN_INTERVAL_SECONDS,
    AUTH_SESSION_TTL_SECONDS: process.env.AUTH_SESSION_TTL_SECONDS,
    AUTH_SESSION_COOKIE_NAME: process.env.AUTH_SESSION_COOKIE_NAME,
  });
  return {
    otpTtlSeconds: parsed.OTP_TTL_SECONDS,
    otpResendCooldownSeconds: parsed.OTP_RESEND_COOLDOWN_SECONDS,
    otpMaxAttempts: parsed.OTP_MAX_ATTEMPTS,
    otpMaxResends: parsed.OTP_MAX_RESENDS,
    otpPhoneMaxPerHour: parsed.OTP_PHONE_MAX_PER_HOUR,
    otpIpMaxPerHour: parsed.OTP_IP_MAX_PER_HOUR,
    otpMinIntervalSeconds: parsed.OTP_MIN_INTERVAL_SECONDS,
    sessionTtlSeconds: parsed.AUTH_SESSION_TTL_SECONDS,
    sessionCookieName: parsed.AUTH_SESSION_COOKIE_NAME,
  };
}

/**
 * Server-side pepper for OTP and IP hashing. No default — production
 * must configure it, and OTP operations fail clearly without it.
 * Rotation note: rotating the pepper invalidates all live (unexpired)
 * OTP challenges — acceptable, they are 5-minute artifacts — and
 * resets IP rate-limit windows. Session tokens are unaffected.
 */
export function requireOtpPepper(): string {
  const pepper = process.env.OTP_PEPPER;
  if (pepper === undefined || pepper.length < 16) {
    throw new Error(
      "OTP_PEPPER must be configured with at least 16 characters for OTP operations.",
    );
  }
  return pepper;
}
