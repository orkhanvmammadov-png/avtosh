/**
 * WhatsApp LIFECYCLE notification abstraction — deliberately separate
 * from the OTP interface so authentication and marketing/lifecycle
 * template semantics can never be confused. Jobs depend only on this
 * interface, never on Meta or a specific BSP SDK.
 *
 * Providers must never log phone numbers, access tokens, or rendered
 * message bodies. `templateCode` is a controlled server-side identity
 * (notification_templates); `params` are structured values the
 * template renders — arbitrary outbound text is not accepted.
 */
export interface WhatsAppNotificationProvider {
  sendTemplate(input: {
    phoneE164: string;
    templateCode: string;
    languageCode: string;
    params: Record<string, string>;
  }): Promise<{ providerMessageId: string | null }>;
}

/**
 * TRANSIENT failures (network, provider 5xx, rate limit) may be
 * retried with backoff under the same notification identity.
 * PERMANENT failures (unknown/unapproved template, invalid recipient,
 * configuration) must not loop.
 */
export class WhatsAppNotificationError extends Error {
  constructor(
    public readonly kind: "TRANSIENT" | "PERMANENT",
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppNotificationError";
  }
}
