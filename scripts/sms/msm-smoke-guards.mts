/**
 * Pure, dependency-free gating for the manual MSM smoke script.
 * FAILS CLOSED; unit-tested; no src/ imports, no network.
 */

/** Fixed, non-secret smoke text — never an OTP. */
export const MSM_SMOKE_TEXT = "Avtosh.az test SMS";

export type MsmSmokeDecision =
  | { ok: true; phoneE164: string }
  | { ok: false; reason: string };

export function planMsmSmoke(env: Record<string, string | undefined>): MsmSmokeDecision {
  if (env.CI !== undefined && env.CI !== "") {
    return { ok: false, reason: "this smoke never runs in CI." };
  }
  if (env.MSM_SMOKE !== "1") {
    return { ok: false, reason: "set MSM_SMOKE=1 plus MSM_* env vars to opt in." };
  }
  if (env.MSM_SMOKE_CONFIRM !== "YES") {
    return {
      ok: false,
      reason:
        "set MSM_SMOKE_CONFIRM=YES only with Owner approval — this sends ONE real SMS on the production MSM account (there is no test environment).",
    };
  }
  const to = env.MSM_SMOKE_TO;
  if (to === undefined || to === "") {
    return {
      ok: false,
      reason: "MSM_SMOKE_TO must be explicitly supplied (the Owner's own number, +994XXXXXXXXX).",
    };
  }
  if (!/^\+994\d{9}$/.test(to)) {
    return { ok: false, reason: "MSM_SMOKE_TO must be canonical +994XXXXXXXXX." };
  }
  return { ok: true, phoneE164: to };
}
