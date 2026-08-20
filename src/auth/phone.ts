import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Normalizes user phone input to E.164 (+994501234567). Azerbaijan is
 * the default region, so national formats like "050 123 45 67" parse
 * correctly; full international input from any country also works.
 * Returns null for anything invalid — callers respond with a generic
 * validation error that reveals nothing about accounts.
 */
export function normalizePhoneE164(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 32) {
    return null;
  }
  const parsed = parsePhoneNumberFromString(trimmed, "AZ");
  if (parsed === undefined || !parsed.isValid()) {
    return null;
  }
  return parsed.number;
}

/** Masked display form, e.g. +994•••••67 — never the full number. */
export function maskPhone(phoneE164: string): string {
  if (phoneE164.length < 7) {
    return "•••";
  }
  return `${phoneE164.slice(0, 4)}${"•".repeat(phoneE164.length - 6)}${phoneE164.slice(-2)}`;
}
