import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a real dev server backed by the accepted ephemeral
 * PostgreSQL harness + deterministic seed (scripts/e2e/seed.mjs). No
 * Supabase is configured, so public image URLs resolve to null — the
 * placeholder path is exercised on every run.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  // Each project gets its own trusted-IP identity so the contact
  // rate limiter (which the dev server activates via its own
  // x-forwarded-for) treats projects as independent sources.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.1" } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.2" } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.3" } } },
  ],
  webServer: {
    command: "./scripts/db/with-temp-postgres.sh sh -c 'node scripts/e2e/seed.mjs && pnpm dev'",
    env: {
      OTP_PEPPER: "e2e-test-pepper-0123456789abcdef", // test-only; enables hashed-IP rate limiting paths
      // Short (not disabled) throttles so real cooldown UI is testable
      // without minute-long sleeps; per-phone isolation comes from
      // distinct test phone numbers (see tests/e2e/auth-helpers.ts).
      OTP_RESEND_COOLDOWN_SECONDS: "2",
      OTP_MIN_INTERVAL_SECONDS: "0",
      OTP_IP_MAX_PER_HOUR: "100",
      OTP_PHONE_MAX_PER_HOUR: "10",
      // Dev/E2E filesystem storage driver (refused in production
      // builds) so the real signed-upload → confirm image flow runs.
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_SUBDIR: "e2e",
      // Fake Kapital Bank (dev-only routes) — the REAL adapter talks
      // to it over HTTP, so request shape/auth/parsing run end to end.
      PAYMENT_FAKE_KAPITAL: "1",
      KAPITAL_API_BASE_URL: "http://localhost:3000/api/dev-kapital",
      KAPITAL_USERNAME: "e2e-merchant",
      KAPITAL_PASSWORD: "e2e-not-a-real-secret",
    },
    url: "http://localhost:3000/api/v1/health",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
