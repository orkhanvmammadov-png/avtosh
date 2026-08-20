/**
 * WhatsApp OTP delivery abstraction. Auth services depend only on
 * this interface — never on Meta or a specific BSP SDK. Providers
 * must throw WhatsAppDeliveryError on definitive failure; they must
 * never log access tokens or message bodies containing the OTP.
 */
export interface WhatsAppOtpProvider {
  sendOtp(input: { phoneE164: string; code: string }): Promise<void>;
}

export class WhatsAppDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppDeliveryError";
  }
}
