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
    env: { OTP_PEPPER: "e2e-test-pepper-0123456789abcdef" }, // test-only; enables hashed-IP rate limiting paths
    url: "http://localhost:3000/api/v1/health",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
