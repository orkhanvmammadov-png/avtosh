import type { WhatsAppOtpProvider } from "@/providers/whatsapp/types";

/**
 * In-memory provider for deterministic tests. Captures sends
 * transiently (never persisted anywhere); tests read the OTP from
 * here instead of parsing logs or weakening the API.
 */
export interface MemoryWhatsAppProvider extends WhatsAppOtpProvider {
  sent: { phoneE164: string; code: string }[];
  failNext: boolean;
  lastCodeFor(phoneE164: string): string | undefined;
  reset(): void;
}

export function createMemoryWhatsAppProvider(): MemoryWhatsAppProvider {
  const provider: MemoryWhatsAppProvider = {
    sent: [],
    failNext: false,
    async sendOtp({ phoneE164, code }) {
      if (provider.failNext) {
        provider.failNext = false;
        const { WhatsAppDeliveryError } = await import(
          "@/providers/whatsapp/types"
        );
        throw new WhatsAppDeliveryError("simulated delivery failure");
      }
      provider.sent.push({ phoneE164, code });
    },
    lastCodeFor(phoneE164) {
      for (let i = provider.sent.length - 1; i >= 0; i -= 1) {
        if (provider.sent[i].phoneE164 === phoneE164) {
          return provider.sent[i].code;
        }
      }
      return undefined;
    },
    reset() {
      provider.sent = [];
      provider.failNext = false;
    },
  };
  return provider;
}
