import { z } from "zod";

/**
 * Kapital Bank e-commerce API configuration. Server-only; parsed
 * lazily so the app boots without it, but any checkout/verification
 * fails closed with a configuration error when required values are
 * missing. Credentials are used exclusively to build the Basic
 * Authorization header inside the adapter — never persisted, logged,
 * or exposed through NEXT_PUBLIC_*.
 */

const schema = z.object({
  KAPITAL_API_BASE_URL: z.string().url(),
  KAPITAL_USERNAME: z.string().min(1),
  KAPITAL_PASSWORD: z.string().min(1),
  KAPITAL_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  /**
   * Hosts the returned hppUrl may use. Defaults to the API host; the
   * dev fake adds localhost. Prevents a malformed/hostile provider
   * response from becoming an open-redirect primitive.
   */
  KAPITAL_ALLOWED_HPP_HOSTS: z.string().optional(),
});

export interface KapitalConfig {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  allowedHppHosts: string[];
  requireHttpsHpp: boolean;
}

export function kapitalConfig(): KapitalConfig {
  const parsed = schema.safeParse({
    KAPITAL_API_BASE_URL: process.env.KAPITAL_API_BASE_URL,
    KAPITAL_USERNAME: process.env.KAPITAL_USERNAME,
    KAPITAL_PASSWORD: process.env.KAPITAL_PASSWORD,
    KAPITAL_TIMEOUT_MS: process.env.KAPITAL_TIMEOUT_MS,
    KAPITAL_ALLOWED_HPP_HOSTS: process.env.KAPITAL_ALLOWED_HPP_HOSTS,
  });
  if (!parsed.success) {
    throw new Error(
      "Kapital Bank payment configuration is missing or invalid (KAPITAL_API_BASE_URL, KAPITAL_USERNAME, KAPITAL_PASSWORD).",
    );
  }
  const apiHost = new URL(parsed.data.KAPITAL_API_BASE_URL).host;
  const extraHosts = (parsed.data.KAPITAL_ALLOWED_HPP_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  return {
    baseUrl: parsed.data.KAPITAL_API_BASE_URL.replace(/\/$/, ""),
    username: parsed.data.KAPITAL_USERNAME,
    password: parsed.data.KAPITAL_PASSWORD,
    timeoutMs: parsed.data.KAPITAL_TIMEOUT_MS,
    allowedHppHosts: [apiHost, ...extraHosts],
    requireHttpsHpp: process.env.NODE_ENV === "production",
  };
}

/** Public app origin for building the provider redirect URL. */
export function appOrigin(): string {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (origin === undefined) {
    throw new Error("NEXT_PUBLIC_APP_URL must be configured to build payment redirect URLs.");
  }
  return origin.replace(/\/$/, "");
}
