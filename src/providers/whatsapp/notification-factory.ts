import { randomUUID } from "node:crypto";
import type { WhatsAppNotificationProvider } from "@/providers/whatsapp/notification-types";

/**
 * Lifecycle-notification provider selection. Production checkpoint:
 * no BSP integration or approved template exists yet, so production
 * FAILS CLOSED — `null` means "no provider": the sender job sends
 * nothing, leaves rows safely SCHEDULED, and logs the condition. It
 * never fabricates delivery. Development uses a deterministic local
 * provider (accepted-only semantics, no real sends).
 */

let testOverride: WhatsAppNotificationProvider | null = null;
let testOverrideSet = false;

/** Test seam — refuses to operate in production builds. */
export function setWhatsAppNotificationProviderForTesting(
  provider: WhatsAppNotificationProvider | null,
  options: { active?: boolean } = {},
): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Provider overrides are not allowed in production.");
  }
  testOverride = provider;
  testOverrideSet = options.active ?? provider !== null;
}

export function getWhatsAppNotificationProvider(): WhatsAppNotificationProvider | null {
  if (testOverrideSet) {
    return testOverride;
  }
  if (process.env.NODE_ENV === "production") {
    return null; // fail closed — pending BSP/template launch checkpoint
  }
  return createDevWhatsAppNotificationProvider();
}

/**
 * Dev/E2E provider: deterministic accept-only stub. Emits a single
 * scrubbed log line (template + message id, never the phone or body).
 */
function createDevWhatsAppNotificationProvider(): WhatsAppNotificationProvider {
  return {
    async sendTemplate(input) {
      const providerMessageId = `dev-${randomUUID()}`;
      console.info(
        JSON.stringify({
          evt: "whatsapp.dev_notification_accepted",
          template_code: input.templateCode,
          provider_message_id: providerMessageId,
        }),
      );
      return { providerMessageId };
    },
  };
}
