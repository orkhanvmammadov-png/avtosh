import "server-only";

/**
 * Launch mode for the phased public release.
 *
 * READ_ONLY (the initial public release): only pure read paths serve —
 * public catalog, search, public listing/detail pages and the legal
 * pages. Every mutation and every side-effecting entry point fails
 * closed at the SERVER (blocking is never just hidden buttons):
 * login/OTP, listing creation/editing, payments, promotions,
 * favorites, reports, moderation/admin writes and scheduled jobs.
 *
 * FAIL-CLOSED DEFAULT: a production runtime without an explicit
 * LAUNCH_MODE is READ_ONLY. Full marketplace operation requires the
 * later, reviewed release to set LAUNCH_MODE=FULL deliberately.
 * Development and test runtimes default to FULL so local UAT and the
 * test suites keep exercising the complete marketplace.
 *
 * Read via process.env on every call (no import-time cache) so route
 * handlers and tests observe the live value.
 */
export type LaunchMode = "READ_ONLY" | "FULL";

export function launchMode(): LaunchMode {
  const explicit = process.env.LAUNCH_MODE;
  if (explicit === "FULL") return "FULL";
  if (explicit === "READ_ONLY") return "READ_ONLY";
  return process.env.NODE_ENV === "production" ? "READ_ONLY" : "FULL";
}

export function isReadOnlyLaunch(): boolean {
  return launchMode() === "READ_ONLY";
}
