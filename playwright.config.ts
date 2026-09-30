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
    { name: "desktop", testIgnore: /read-only-ui\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.1" } } },
    { name: "tablet", testIgnore: /read-only-ui\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.2" } } },
    { name: "mobile", testIgnore: /read-only-ui\.spec\.ts/, use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.3" } } },
    // WebKit tap-sequence run for the dropdown interaction only. It
    // exercises WebKit's touch pipeline but does NOT prove physical
    // iOS Safari behavior (Owner UAT does that).
    { name: "mobile-webkit", testMatch: /dropdown-swipe\.spec\.ts/, use: { ...devices["iPhone 13"], extraHTTPHeaders: { "x-forwarded-for": "203.0.113.6" } } },
    // Read-only launch UI runs against the second (READ_ONLY) server.
    { name: "read-only-desktop", testMatch: /read-only-ui\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: "http://localhost:3001", extraHTTPHeaders: { "x-forwarded-for": "203.0.113.4" } } },
    { name: "read-only-mobile", testMatch: /read-only-ui\.spec\.ts/, use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, baseURL: "http://localhost:3001", extraHTTPHeaders: { "x-forwarded-for": "203.0.113.5" } } },
  ],
  webServer: [{
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
      // Scheduled-job endpoints (Phase 4.16) — test-only cron secret.
      CRON_SECRET: "e2e-cron-secret-0123456789abcdef",
    },
    url: "http://localhost:3000/api/v1/health",
    reuseExistingServer: false,
    timeout: 240_000,
  }, {
    // Second server in READ_ONLY launch mode (own ephemeral DB +
    // seed) so the read-only public UI is tested against real pages.
    command: "./scripts/db/with-temp-postgres.sh sh -c 'node scripts/e2e/seed.mjs && pnpm dev -p 3001'",
    env: {
      LAUNCH_MODE: "READ_ONLY",
      // Separate dist dir: Next's dev-server lock lives in distDir,
      // and the FULL server on :3000 already holds .next.
      NEXT_DIST_DIR: ".next-readonly-e2e",
      // Keep the FULL server's .e2e-seed.json (used by helpers) intact.
      E2E_SEED_OUT: ".e2e-seed-readonly.json",
      OTP_PEPPER: "e2e-test-pepper-0123456789abcdef",
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_SUBDIR: "e2e-readonly",
    },
    url: "http://localhost:3001/api/v1/health",
    reuseExistingServer: false,
    timeout: 240_000,
  }],
});
