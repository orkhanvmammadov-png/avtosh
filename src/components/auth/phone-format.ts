/**
 * Presentation-only helpers for the Azerbaijani local phone input
 * (Phase 4.17O.1). The visible value prefers the familiar national
 * form `0XX XXX XX XX` (e.g. 010 218 41 91); anything containing "+"
 * is treated as deliberate international input and passed through
 * untouched so full E.164 typing/pasting keeps working. These
 * helpers are NOT normalization — the server's normalizePhoneE164
 * remains the single authoritative canonicalization path.
 */

const LOCAL_GROUPS = [3, 3, 2, 2] as const; // 0XX XXX XX XX
const LOCAL_DIGITS = 10;

/** Live input formatter: groups a local national number as the user types. */
export function formatAzLocalPhoneInput(raw: string): string {
  if (raw.includes("+")) {
    return raw; // international form — never rewrite while typing/pasting
  }
  const digits = raw.replace(/\D/g, "").slice(0, LOCAL_DIGITS);
  let out = "";
  let index = 0;
  for (const size of LOCAL_GROUPS) {
    if (index >= digits.length) break;
    if (out.length > 0) out += " ";
    out += digits.slice(index, index + size);
    index += size;
  }
  return out;
}

/**
 * Human-friendly destination display for the OTP step: an Azerbaijani
 * number (canonical or as typed) renders as `0XX XXX XX XX`; anything
 * else renders exactly as the user entered it.
 */
export function formatAzPhoneForDisplay(entered: string): string {
  const compact = entered.replace(/[\s\-()]/g, "");
  let national: string | null = null;
  if (/^\+994\d{9}$/.test(compact)) {
    national = `0${compact.slice(4)}`;
  } else if (/^0\d{9}$/.test(compact)) {
    national = compact;
  }
  if (national === null) {
    return entered;
  }
  return formatAzLocalPhoneInput(national);
}
