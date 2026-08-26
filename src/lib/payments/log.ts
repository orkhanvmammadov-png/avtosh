/**
 * Structured, scrubbed payment observability. Only allowlisted scalar
 * fields are ever emitted — Authorization headers, HPP passwords,
 * provider secrets, card data, and raw provider payloads have no path
 * into these events by construction.
 */

type SafeValue = string | number | boolean | null | undefined;

export function logPaymentEvent(
  event:
    | "checkout_requested"
    | "provider_order_created"
    | "provider_order_orphaned"
    | "verification_requested"
    | "provider_status_observed"
    | "payment_succeeded"
    | "fulfillment_completed"
    | "verification_failed"
    | "amount_currency_mismatch"
    | "unknown_provider_status"
    | "checkout_initiation_failed"
    | "promotion_purchase_created"
    | "promotion_activated"
    | "promotion_extended",
  fields: Record<string, SafeValue>,
): void {
  console.info(JSON.stringify({ evt: `payment.${event}`, ...fields }));
}
