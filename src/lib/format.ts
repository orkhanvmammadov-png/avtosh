/**
 * Buyer-facing formatters (Azerbaijani locale conventions). Money is
 * integer-only: minor units → whole AZN + kopeks without floats.
 */

const GROUP = /\B(?=(\d{3})+(?!\d))/g;

function groupDigits(value: number): string {
  return String(value).replace(GROUP, " ");
}

/** 200000 minor → "2 000 AZN"; 150050 → "1 500,50 AZN". Exact integer math (no floats, no BigInt). */
export function formatPriceMinor(minor: number | null, currency = "AZN"): string {
  if (minor === null || !Number.isSafeInteger(minor) || minor < 0) {
    return "Qiymət göstərilməyib";
  }
  const cents = minor % 100;
  const major = (minor - cents) / 100; // exact: minor - cents is divisible by 100
  const base = groupDigits(major);
  const formatted = cents === 0 ? base : `${base},${String(cents).padStart(2, "0")}`;
  return `${formatted} ${currency}`;
}

export function formatMileage(km: number | null): string {
  if (km === null) return "—";
  return `${groupDigits(km)} km`;
}

export function formatYear(year: number | null): string {
  return year === null ? "—" : String(year);
}

/**
 * "bugün", "dünən", "3 gün əvvəl", else DD.MM.YYYY in Asia/Baku.
 *
 * HYDRATION CONTRACT: this renders in server HTML AND during client
 * hydration, so both inputs must be identical on both sides.
 * - `nowMs` is REQUIRED and must be a server-supplied reference
 *   timestamp threaded through props (never an implicit `new Date()`
 *   evaluated separately on each runtime — that flips "dünən"/day
 *   counts across render moments and midnight boundaries).
 * - The absolute branch reuses formatDateAz (parts-assembled, fixed
 *   Asia/Baku). `toLocaleDateString("az-AZ", …)` is FORBIDDEN here:
 *   Node's full ICU formats it as "22.07.2026" while Chromium's az
 *   data resolves the same skeleton to the root pattern
 *   "2026-07-22" — a byte-level SSR/client mismatch.
 */
export function formatFreshness(iso: string, nowMs: number): string {
  const published = new Date(iso);
  const days = Math.floor((nowMs - published.getTime()) / 86_400_000);
  if (days <= 0) return "bugün";
  if (days === 1) return "dünən";
  if (days < 30) return `${days} gün əvvəl`;
  return formatDateAz(published);
}

export function vehicleTitle(input: { brand: string | null; model: string | null; year: number | null }): string {
  const parts = [input.brand, input.model, input.year === null ? null : String(input.year)].filter(
    (p): p is string => p !== null && p.length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : "Elan";
}

/** "20000" AZN (buyer input) → "2000000" minor for the API; null when not a whole non-negative number. */
export function aznInputToMinor(input: string): string | null {
  const trimmed = input.trim().replace(/\s+/g, "");
  if (!/^\d{1,11}$/.test(trimmed)) return null;
  return `${trimmed}00`;
}

/** "2000000" minor (URL/API) → "20000" AZN for form display; kopeks are dropped for whole-AZN inputs. */
export function minorToAznInput(minor: string | undefined): string {
  if (minor === undefined || !/^\d+$/.test(minor)) return "";
  return minor.length <= 2 ? "0" : minor.slice(0, -2);
}

/** DD.MM.YYYY in Asia/Baku — promotion end dates on seller surfaces. */
export function formatDateAz(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("az-Latn-AZ", {
    timeZone: "Asia/Baku",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

/**
 * HH:MM in Asia/Baku — parts-assembled for the same reason as
 * formatDateAz: locale-pattern lookups differ between Node's and
 * Chromium's ICU data, and this renders inside hydrating components.
 */
export function formatTimeAz(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("az-Latn-AZ", {
    timeZone: "Asia/Baku",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")}`;
}
