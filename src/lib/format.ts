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

/** "bugün", "dünən", "3 gün əvvəl", else a short date. */
export function formatFreshness(iso: string, now: Date = new Date()): string {
  const published = new Date(iso);
  const days = Math.floor((now.getTime() - published.getTime()) / 86_400_000);
  if (days <= 0) return "bugün";
  if (days === 1) return "dünən";
  if (days < 30) return `${days} gün əvvəl`;
  return published.toLocaleDateString("az-AZ", { day: "2-digit", month: "2-digit", year: "numeric" });
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
