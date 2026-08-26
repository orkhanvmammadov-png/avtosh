import { createKapitalProvider } from "@/providers/payments/kapital-provider";
import type { PaymentProviderClient } from "@/providers/payments/types";

/**
 * Provider selection. Kapital is the only real provider; tests inject
 * a deterministic fake (never allowed in production builds). The E2E
 * suite keeps THIS real adapter and points KAPITAL_API_BASE_URL at a
 * dev-only fake Kapital API instead, so the transport contract is
 * exercised end to end.
 */

let testOverride: PaymentProviderClient | null = null;

export function setPaymentProviderForTesting(provider: PaymentProviderClient | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Payment provider overrides are not allowed in production.");
  }
  testOverride = provider;
}

export function getPaymentProvider(): PaymentProviderClient {
  if (testOverride !== null) {
    return testOverride;
  }
  return createKapitalProvider();
}

/** The provider code persisted on payments/attempt rows. */
export const PAYMENT_PROVIDER_CODE = "KAPITAL";
