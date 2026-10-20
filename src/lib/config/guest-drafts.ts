/**
 * Guest draft foundation (PR A) — server-side switch and limits.
 *
 * FAIL-CLOSED: the feature exists only when GUEST_DRAFTS_ENABLED is
 * exactly "true". Missing, empty, malformed, or any other value means
 * OFF, and every guest endpoint answers with the same non-enumerating
 * LISTING_NOT_FOUND an unknown resource gets.
 *
 * The lifetime and draft cap are deliberate product constants (Owner
 * spec: fixed seven days, at most two live guest drafts per session),
 * not tunables. The per-IP issuance/creation ceilings are abuse
 * brakes, env-overridable for load tests only.
 */

export const GUEST_SESSION_TTL_SECONDS = 7 * 24 * 3600;
export const GUEST_MAX_LIVE_DRAFTS = 2;

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function guestDraftsEnabled(): boolean {
  return process.env.GUEST_DRAFTS_ENABLED === "true";
}

export interface GuestDraftLimits {
  sessionsPerIpPerHour: number;
  draftsPerIpPerHour: number;
  /** Signed-URL issuance brake per guest session per hour (PR B):
      bounds temp-storage cost even when uploads are never confirmed.
      Headroom above maxImages × a few retries; never affects sellers. */
  uploadsPerSessionPerHour: number;
}

export function guestDraftLimits(): GuestDraftLimits {
  return {
    sessionsPerIpPerHour: envInt("GUEST_SESSIONS_IP_MAX_PER_HOUR", 10),
    draftsPerIpPerHour: envInt("GUEST_DRAFTS_IP_MAX_PER_HOUR", 20),
    uploadsPerSessionPerHour: envInt("GUEST_UPLOADS_SESSION_MAX_PER_HOUR", 60),
  };
}
