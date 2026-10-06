// Relative (not @/) imports: the manual smoke script loads this
// adapter under plain `node`, which cannot resolve the tsconfig path
// alias. Next/vitest resolve both forms identically.
import { MSM_SEND_ENDPOINT, msmConfig } from "../../lib/config/msm.ts";
import { WhatsAppDeliveryError, type WhatsAppOtpProvider } from "../whatsapp/types.ts";

/**
 * MSM Technologies SMS adapter (Owner-confirmed contract, 2026-10):
 *
 *   HTTPS POST https://v1.msm.az/sendsms with an XML body
 *   <CLIENT user pwd from/> + <INSERT to text/>; success response
 *   <SMS-Response><STATUS res="100" restxt="OK" id="…"/></SMS-Response>.
 *
 * res="100" means PROVIDER ACCEPTANCE only — never proof of handset
 * delivery (delivery is proven by the user typing the code). Every
 * other code, malformed response, HTTP error or timeout fails closed
 * with WhatsAppDeliveryError, and a send is NEVER retried here: an
 * ambiguous outcome (timeout after the request left) could otherwise
 * double-charge and double-deliver. The auth service expires the
 * challenge on failure; the user's recovery path is a fresh request
 * after OTP_MIN_INTERVAL_SECONDS.
 *
 * Request root element <SMS-InsRequest> is Owner-confirmed from the
 * supplied MSM contract. Still unverified until the first controlled
 * live test: the Content-Type (application/xml; charset=utf-8
 * chosen).
 *
 * Never logged or thrown: credentials, the OTP, the message text,
 * the XML, or the full phone number. Only the numeric res code and
 * the provider message id are surfaced.
 */

const MSM_OK = "100";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Canonical +994XXXXXXXXX → MSM's 9-digit local form (50XXXXXXX),
 * exactly once. Anything else is refused before any network call —
 * the product is AZ-only and a silently reformatted number would be
 * a wrong-recipient hazard.
 */
export function msmRecipientFromE164(phoneE164: string): string {
  const match = /^\+994(\d{9})$/.exec(phoneE164);
  if (match === null) {
    throw new WhatsAppDeliveryError("Unsupported phone format for SMS delivery.");
  }
  return match[1]!;
}

export function buildMsmRequestXml(input: {
  username: string;
  apiKey: string;
  sender: string;
  to: string;
  text: string;
}): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<SMS-InsRequest>` +
    `<CLIENT user="${xmlEscape(input.username)}" pwd="${xmlEscape(input.apiKey)}" from="${xmlEscape(input.sender)}"/>` +
    `<INSERT to="${xmlEscape(input.to)}" text="${xmlEscape(input.text)}"/>` +
    `</SMS-InsRequest>`
  );
}

export interface MsmSendResult {
  /** Provider message id — safe to log/report (needed by MSM support). */
  messageId: string | null;
}

/** One send, one fetch, no retry. `text` must never contain secrets
    beyond the OTP itself (which exists only inside the SMS body). */
export async function sendMsmSms(input: { phoneE164: string; text: string }): Promise<MsmSendResult> {
  const config = msmConfig();
  const to = msmRecipientFromE164(input.phoneE164);
  const body = buildMsmRequestXml({
    username: config.username,
    apiKey: config.apiKey,
    sender: config.sender,
    to,
    text: input.text,
  });

  let response: Response;
  try {
    response = await fetch(MSM_SEND_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/xml; charset=utf-8",
        accept: "application/xml, text/xml",
      },
      body,
      // Any redirect is refused outright — the contract is exactly
      // this HTTPS endpoint; following could re-send the credentials
      // and OTP to another host.
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
  } catch {
    // Timeout / DNS / reset / redirect — AMBIGUOUS (the SMS may have
    // been accepted). Fail closed, never retry here.
    throw new WhatsAppDeliveryError("SMS provider is unreachable.");
  }
  if (!response.ok) {
    throw new WhatsAppDeliveryError(`SMS provider returned HTTP ${response.status}.`);
  }
  let responseText = "";
  try {
    responseText = await response.text();
  } catch {
    throw new WhatsAppDeliveryError("SMS provider response could not be read.");
  }
  // Tolerant extraction of the documented STATUS attributes; restxt
  // (free text) is deliberately never read.
  const res = /<STATUS\b[^>]*\bres="(\d{1,4})"/.exec(responseText)?.[1];
  const messageId = /<STATUS\b[^>]*\bid="([A-Za-z0-9_-]{1,64})"/.exec(responseText)?.[1] ?? null;
  if (res === undefined) {
    throw new WhatsAppDeliveryError("SMS provider returned a malformed response.");
  }
  if (res !== MSM_OK) {
    throw new WhatsAppDeliveryError(`SMS provider rejected the message (res=${res}).`);
  }
  console.info(JSON.stringify({ evt: "otp.msm_send_accepted", res, message_id: messageId }));
  return { messageId };
}

/** OTP delivery through MSM, behind the existing provider seam. */
export function createMsmSmsOtpProvider(): WhatsAppOtpProvider {
  return {
    async sendOtp({ phoneE164, code }) {
      if (!/^\d{4,8}$/.test(code)) {
        // Defense in depth: the OTP generator emits digits only; any
        // other shape must never reach an outbound SMS body.
        throw new WhatsAppDeliveryError("Invalid OTP shape for SMS delivery.");
      }
      // ASCII-only wording until MSM confirms UTF-8 handling for
      // Azerbaijani characters (documented open question).
      await sendMsmSms({ phoneE164, text: `Avtosh.az giris kodu: ${code}` });
    },
  };
}
