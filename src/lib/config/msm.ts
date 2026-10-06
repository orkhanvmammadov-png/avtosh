import { z } from "zod";

/**
 * MSM Technologies SMS gateway configuration. Server-only; parsed
 * lazily so the app boots without it, and OTP delivery fails closed
 * with a clear error when required values are missing. Credentials
 * are used exclusively inside the adapter's XML request body — never
 * in URLs, logs, errors, or NEXT_PUBLIC_*.
 *
 * The endpoint is deliberately NOT configurable: the Owner-confirmed
 * contract is HTTPS POST to v1.msm.az only (never the legacy HTTP
 * GET endpoint, never credentials in query parameters, never a
 * downgrade or another host).
 */

export const MSM_SEND_ENDPOINT = "https://v1.msm.az/sendsms";

const schema = z.object({
  MSM_USERNAME: z.string().min(1),
  MSM_API_KEY: z.string().min(1),
  /** Registered sender name — Owner-confirmed exact value. */
  MSM_SENDER: z.string().min(1).default("Avtosh.az"),
  MSM_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
});

export interface MsmConfig {
  username: string;
  apiKey: string;
  sender: string;
  timeoutMs: number;
}

export function msmConfig(): MsmConfig {
  const parsed = schema.safeParse({
    MSM_USERNAME: process.env.MSM_USERNAME,
    MSM_API_KEY: process.env.MSM_API_KEY,
    MSM_SENDER: process.env.MSM_SENDER,
    MSM_TIMEOUT_MS: process.env.MSM_TIMEOUT_MS,
  });
  if (!parsed.success) {
    throw new Error(
      "MSM SMS configuration is missing or invalid (MSM_USERNAME, MSM_API_KEY).",
    );
  }
  return {
    username: parsed.data.MSM_USERNAME,
    apiKey: parsed.data.MSM_API_KEY,
    sender: parsed.data.MSM_SENDER,
    timeoutMs: parsed.data.MSM_TIMEOUT_MS,
  };
}
