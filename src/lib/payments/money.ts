/**
 * Exact money conversion between AVTOSH integer minor units and the
 * provider's major-unit decimal strings. Pure integer/string math —
 * floating point is never used for financial values.
 */

/** 200 → "2.00", 250 → "2.50", 1 → "0.01". */
export function minorToMajorString(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error("Invalid minor amount.");
  }
  const cents = minor % 100;
  const major = (minor - cents) / 100;
  return `${major}.${String(cents).padStart(2, "0")}`;
}

/**
 * Strict decimal → minor units. Accepts "2", "2.5", "2.50" (and the
 * provider's JSON-number serializations thereof); rejects anything
 * else — a rejected amount can never match, so a malformed provider
 * amount can never fulfill.
 */
export function majorToMinorExact(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text);
  if (match === null) {
    return null;
  }
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return Number(match[1]) * 100 + Number(fraction);
}
