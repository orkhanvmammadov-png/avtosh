import { createDevWhatsAppProvider } from "@/providers/whatsapp/dev-provider";
import type { WhatsAppOtpProvider } from "@/providers/whatsapp/types";

/**
 * Provider selection. Production checkpoint: a real Meta/BSP-backed
 * provider is NOT integrated yet — production OTP sending fails
 * loudly until one is implemented and approved. Development and test
 * environments use the dev/in-memory providers.
 */

let testOverride: WhatsAppOtpProvider | null = null;

/** Test seam — refuses to operate in production builds. */
export function setWhatsAppOtpProviderForTesting(
  provider: WhatsAppOtpProvider | null,
): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Provider overrides are not allowed in production.");
  }
  testOverride = provider;
}

export function getWhatsAppOtpProvider(): WhatsAppOtpProvider {
  if (testOverride !== null) {
    return testOverride;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No production WhatsApp provider is configured yet — OTP delivery is a pending integration checkpoint.",
    );
  }
  return createDevWhatsAppProvider();
}
