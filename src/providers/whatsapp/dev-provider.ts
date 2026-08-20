import { maskPhone } from "@/auth/phone";
import type { WhatsAppOtpProvider } from "@/providers/whatsapp/types";

/**
 * Development-only provider: no real delivery; the OTP is exposed
 * exclusively through the local server log so a developer can log in
 * without WhatsApp credentials. Hard-guarded against production use.
 */
export function createDevWhatsAppProvider(): WhatsAppOtpProvider {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "The development WhatsApp provider must never run in production.",
    );
  }
  return {
    async sendOtp({ phoneE164, code }) {
      // Development-only console exposure (guarded above); phone masked.
      console.info(`[dev-whatsapp] OTP for ${maskPhone(phoneE164)}: ${code}`);
    },
  };
}
