/**
 * Pure, dependency-free guard logic for the manual Kapital smoke
 * script. Everything here FAILS CLOSED and is unit-tested; the
 * script itself stays a thin shell. No src/ imports, no network.
 */
import { lstatSync, writeFileSync } from "node:fs";

/** The only intended Kapital API origins — compared as exact URL
    origins, never substrings (no `evil-kapitalbank.az` bypass). */
export const KAPITAL_PRODUCTION_ORIGIN = "https://e-commerce.kapitalbank.az";
export const KAPITAL_TEST_ORIGIN = "https://txpgtst.kapitalbank.az";

/** Hard cap for a smoke order, production confirmation or not. */
export const MAX_SMOKE_AMOUNT = 10;

export type SmokePlan =
  | { mode: "verify"; orderId: string }
  | { mode: "create"; isProduction: boolean; amountMajor: string; redirectUrl: string };

export type SmokeDecision = { ok: true; plan: SmokePlan } | { ok: false; reason: string };

export function planSmokeRun(env: Record<string, string | undefined>): SmokeDecision {
  if (env.KAPITAL_SMOKE !== "1") {
    return { ok: false, reason: "set KAPITAL_SMOKE=1 plus KAPITAL_* env vars to opt in." };
  }

  let origin: string;
  try {
    origin = new URL(env.KAPITAL_API_BASE_URL ?? "").origin;
  } catch {
    return { ok: false, reason: "KAPITAL_API_BASE_URL is missing or not a valid URL." };
  }
  if (origin !== KAPITAL_PRODUCTION_ORIGIN && origin !== KAPITAL_TEST_ORIGIN) {
    return {
      ok: false,
      reason: `API origin ${origin} is not an intended Kapital endpoint (expected exactly ${KAPITAL_PRODUCTION_ORIGIN} or ${KAPITAL_TEST_ORIGIN}).`,
    };
  }
  const isProduction = origin === KAPITAL_PRODUCTION_ORIGIN;

  const orderId = env.KAPITAL_SMOKE_ORDER_ID;
  if (orderId !== undefined && orderId !== "") {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) {
      return { ok: false, reason: "KAPITAL_SMOKE_ORDER_ID has an invalid shape." };
    }
    return { ok: true, plan: { mode: "verify", orderId } };
  }

  // CREATE mode — every requirement is explicit, regardless of host:
  // an order on EITHER terminal is a payable artifact.
  if (env.KAPITAL_SMOKE_CONFIRM_PRODUCTION !== "YES") {
    return {
      ok: false,
      reason:
        "create mode requires KAPITAL_SMOKE_CONFIRM_PRODUCTION=YES (Owner-approved run) — a real card on the resulting HPP moves real money on the production terminal.",
    };
  }
  const amount = env.KAPITAL_SMOKE_AMOUNT;
  if (amount === undefined || amount === "") {
    return {
      ok: false,
      reason: "create mode requires an explicitly supplied, Owner-approved KAPITAL_SMOKE_AMOUNT (no default).",
    };
  }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > MAX_SMOKE_AMOUNT) {
    return { ok: false, reason: `KAPITAL_SMOKE_AMOUNT must be a decimal in (0, ${MAX_SMOKE_AMOUNT}].` };
  }

  const appUrlRaw = env.NEXT_PUBLIC_APP_URL;
  if (appUrlRaw === undefined || appUrlRaw === "") {
    return {
      ok: false,
      reason: "create mode requires an explicit NEXT_PUBLIC_APP_URL (no localhost fallback).",
    };
  }
  let appUrl: URL;
  try {
    appUrl = new URL(appUrlRaw);
  } catch {
    return { ok: false, reason: "NEXT_PUBLIC_APP_URL is not a valid URL." };
  }
  if (isProduction && appUrl.protocol !== "https:") {
    return { ok: false, reason: "a production order requires an HTTPS NEXT_PUBLIC_APP_URL." };
  }

  return {
    ok: true,
    plan: {
      mode: "create",
      isProduction,
      amountMajor: amount,
      redirectUrl: `${appUrl.origin}/odenis/kapital/netice`,
    },
  };
}

/**
 * The checkout URL (HPP URL + order password) may only ever be
 * stored or presented over HTTPS — independently of NODE_ENV (the
 * adapter's own HTTPS policy is production-only, but this script
 * runs from an operator shell where NODE_ENV is unset).
 */
export function assertHttpsCheckoutUrl(rawUrl: string): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "the provider checkout URL is not a valid URL." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "the provider checkout URL is not HTTPS; refusing to store or present it." };
  }
  return { ok: true };
}

/** True when ANYTHING (file, symlink, dir — dangling included) sits at the path. */
export function pathOccupied(filePath: string): boolean {
  try {
    lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes the sensitive URL file exclusively: O_EXCL (`wx`) refuses
 * an existing file or symlink atomically — never overwrites, never
 * follows a link — and the file is born 0600.
 */
export function writeUrlFileExclusive(
  filePath: string,
  contents: string,
): { ok: true } | { ok: false; reason: string } {
  try {
    writeFileSync(filePath, contents, { flag: "wx", mode: 0o600 });
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: `refusing to write ${filePath}: the path already exists (file or symlink). Delete it and re-run.`,
    };
  }
}
