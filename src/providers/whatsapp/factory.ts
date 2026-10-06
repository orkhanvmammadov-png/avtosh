import { createDevWhatsAppProvider } from "@/providers/whatsapp/dev-provider";
import { createMsmSmsOtpProvider } from "@/providers/sms/msm-otp-provider";
import type { WhatsAppOtpProvider } from "@/providers/whatsapp/types";

/**
 * OTP delivery provider selection. The Owner-selected production
 * channel is MSM Technologies SMS (OTP_SMS_PROVIDER=msm — an
 * explicit opt-in in every environment; config validation then
 * requires the MSM secrets). Without it, production OTP sending
 * still fails loudly, and development/test keep the dev/in-memory
 * providers. The interface predates the channel decision, hence the
 * WhatsApp naming — delivery semantics are identical.
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
  if (process.env.OTP_SMS_PROVIDER === "msm") {
    return createMsmSmsOtpProvider();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No production WhatsApp provider is configured yet — OTP delivery is a pending integration checkpoint.",
    );
  }
  return createDevWhatsAppProvider();
}
