import "server-only";

/**
 * Owner-only production PILOT gate for the FULL launch.
 *
 * `LAUNCH_PILOT_PHONES` (Production-only secret env, comma-separated
 * E.164 +994XXXXXXXXX values, never NEXT_PUBLIC_*) activates the
 * pilot: while set, only the listed phones can authenticate or hold
 * a usable session, and the anonymous mutation endpoints (contact
 * reveal, reports) refuse. Public read-only browsing stays open, and
 * cron-authenticated jobs plus session-independent payment
 * verification keep working, so an already-created Owner order still
 * verifies and reconciles.
 *
 * FAIL CLOSED: when the variable is set but ANY entry is malformed,
 * the pilot is active with an EMPTY allowlist — everyone is refused
 * (including the Owner) rather than anyone slipping through — and
 * one sanitized log line reports only the invalid-entry count, never
 * a phone number. Unset/empty means no pilot (normal FULL behavior).
 */

const PILOT_PHONE_SHAPE = /^\+994\d{9}$/;

export type PilotGate =
  | { active: false }
  | { active: true; isAllowed: (phoneE164: string) => boolean };

let warnedInvalid: string | null = null;

/** Read live on every call (same pattern as launch mode) so tests and
    operators never fight a cached value. */
export function pilotGate(): PilotGate {
  const raw = process.env.LAUNCH_PILOT_PHONES;
  if (raw === undefined || raw.trim() === "") {
    return { active: false };
  }
  const entries = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const invalid = entries.filter((value) => !PILOT_PHONE_SHAPE.test(value));
  if (entries.length === 0 || invalid.length > 0) {
    if (warnedInvalid !== raw) {
      warnedInvalid = raw;
      console.error(
        JSON.stringify({
          level: "error",
          event: "launch_pilot_misconfigured",
          invalid_entries: invalid.length,
          detail: "LAUNCH_PILOT_PHONES is set but malformed — pilot is FAIL-CLOSED (nobody allowed).",
        }),
      );
    }
    return { active: true, isAllowed: () => false };
  }
  const allowed = new Set(entries);
  return { active: true, isAllowed: (phoneE164: string) => allowed.has(phoneE164) };
}
