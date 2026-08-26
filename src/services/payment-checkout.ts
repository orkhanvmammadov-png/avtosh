import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { appOrigin } from "@/lib/config/kapital";
import { minorToMajorString } from "@/lib/payments/money";
import { logPaymentEvent } from "@/lib/payments/log";
import { getSql, withTransaction } from "@/lib/server/db/client";
import {
  findActiveAttempt,
  findAttemptByProviderOrder,
  findListingFeePayment,
  getPaymentSummary,
  insertAttempt,
  insertSystemStatusHistory,
  lockPayment,
  listStalePendingPayments,
  markPaymentPending,
  markPaymentRefunded,
  markPaymentSucceeded,
  recordAttemptStatus,
  resetPaymentToCreated,
  terminalizeAttempt,
  transitionListingPaymentCompleted,
} from "@/repositories/payment-checkout";
import { insertOutboxEvent } from "@/repositories/listing-publications";
import { buildHppRedirect } from "@/providers/payments/kapital-provider";
import {
  getPaymentProvider,
  PAYMENT_PROVIDER_CODE,
} from "@/providers/payments/factory";
import {
  PaymentProviderError,
  type ProviderOrderDetails,
} from "@/providers/payments/types";

/**
 * LISTING_FEE checkout & verification (Phase 4.12, Kapital Bank).
 *
 * Authority model: the browser callback (ID/STATUS query) is a hint
 * only. The ONLY path to SUCCESS/fulfillment is an authenticated
 * server-to-server Get Order Details whose status is FullyPaid AND
 * whose amount/currency exactly match the immutable intent snapshot.
 * Provider network calls always happen OUTSIDE database transactions;
 * every state move happens under the payment row lock, giving
 * exactly-once fulfillment across callbacks, refreshes, concurrent
 * requests and reconciliation.
 */

const CHECKOUT_ELIGIBLE_STATUSES = ["CREATED", "PENDING"];
/** Documented terminal non-success provider statuses (see docs note). */
const RETRYABLE_PROVIDER_STATUSES = ["Cancelled", "Declined", "Expired"];

export interface CheckoutResult {
  checkoutUrl: string;
}

export async function createListingFeeCheckout(
  auth: AuthContext,
  listingId: string,
): Promise<CheckoutResult> {
  const sql = getSql();
  const context = await findListingFeePayment(sql, listingId, auth.user.id);
  if (context === undefined) {
    // missing, foreign, or FREE listing — one indistinguishable answer
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  if (
    context.listing_status !== "PAYMENT_REQUIRED" ||
    context.payment_type !== "LISTING_FEE" ||
    !CHECKOUT_ELIGIBLE_STATUSES.includes(context.payment_status)
  ) {
    throw new ApiError("PAYMENT_NOT_REQUIRED", "The listing has no payable fee right now.");
  }
  logPaymentEvent("checkout_requested", {
    payment_id: context.payment_id,
    listing_id: context.listing_id,
  });

  // Reuse the active checkout when one exists — refreshes and repeat
  // clicks never mint new provider orders.
  const active = await findActiveAttempt(sql, context.payment_id);
  if (active !== undefined && active.hpp_secret !== null) {
    return {
      checkoutUrl: buildHppRedirect(active.hpp_url, active.provider_order_id, active.hpp_secret),
    };
  }

  // Provider order creation: OUTSIDE any transaction or row lock. The
  // amount is the immutable intent snapshot — never a current setting,
  // never browser input.
  let order;
  try {
    order = await getPaymentProvider().createOrder({
      amountMajor: minorToMajorString(Number(context.amount_minor)),
      currency: context.currency,
      language: "az",
      description: `AVTOSH.AZ elan ${context.listing_public_id} yerlesdirme haqqi`,
      redirectUrl: `${appOrigin()}/odenis/kapital/netice`,
    });
  } catch (error) {
    logPaymentEvent("checkout_initiation_failed", {
      payment_id: context.payment_id,
      kind: error instanceof PaymentProviderError ? error.kind : "UNKNOWN",
    });
    throw new ApiError(
      "PAYMENT_CHECKOUT_UNAVAILABLE",
      "Payment initiation is temporarily unavailable.",
    );
  }

  return withTransaction(async (tx) => {
    const payment = await lockPayment(tx, context.payment_id);
    if (payment === undefined || !CHECKOUT_ELIGIBLE_STATUSES.includes(payment.status)) {
      // verified/paid meanwhile — the fresh provider order is an orphan
      logPaymentEvent("provider_order_orphaned", {
        payment_id: context.payment_id,
        provider_order_id: order.providerOrderId,
        reason: "payment_no_longer_eligible",
      });
      throw new ApiError("PAYMENT_NOT_REQUIRED", "The listing has no payable fee right now.");
    }
    const inserted = await insertAttempt(tx, {
      paymentId: payment.id,
      provider: PAYMENT_PROVIDER_CODE,
      providerOrderId: order.providerOrderId,
      hppUrl: order.hppUrl,
      hppSecret: order.hppSecret,
      providerStatus: order.status,
    });
    if (inserted === null) {
      // a concurrent request won the one-active-attempt race — reuse
      // the winner; our provider order becomes a harmless unpaid orphan
      logPaymentEvent("provider_order_orphaned", {
        payment_id: payment.id,
        provider_order_id: order.providerOrderId,
        reason: "concurrent_checkout",
      });
      const winner = await findActiveAttempt(tx, payment.id);
      if (winner !== undefined && winner.hpp_secret !== null) {
        return {
          checkoutUrl: buildHppRedirect(winner.hpp_url, winner.provider_order_id, winner.hpp_secret),
        };
      }
      throw new ApiError("PAYMENT_CHECKOUT_UNAVAILABLE", "Payment initiation is temporarily unavailable.");
    }
    await markPaymentPending(tx, payment.id, PAYMENT_PROVIDER_CODE, order.providerOrderId);
    logPaymentEvent("provider_order_created", {
      payment_id: payment.id,
      provider_order_id: order.providerOrderId,
      provider_status: order.status,
    });
    return {
      checkoutUrl: buildHppRedirect(order.hppUrl, order.providerOrderId, order.hppSecret),
    };
  });
}

export type VerificationOutcome =
  | { state: "SUCCESS"; listingPublicId: string | null }
  | { state: "PENDING" }
  | { state: "RETRYABLE" }
  | { state: "REFUNDED" }
  | { state: "MISMATCH" }
  | { state: "CHECK_FAILED" };

/** Outcome derived purely from the internal payment when no active attempt exists. */
function outcomeFromPaymentStatus(status: string, listingPublicId: string | null): VerificationOutcome {
  switch (status) {
    case "SUCCESS":
      return { state: "SUCCESS", listingPublicId };
    case "REFUNDED":
      return { state: "REFUNDED" };
    case "CREATED":
      return { state: "RETRYABLE" };
    default:
      return { state: "PENDING" };
  }
}

/**
 * The single verification + fulfillment path used by the callback
 * page, "Yenidən yoxla", and reconciliation. Idempotent: repeated
 * calls for a FullyPaid order settle into the same terminal state
 * with exactly one fulfillment.
 */
export async function verifyProviderPayment(paymentId: string): Promise<VerificationOutcome> {
  const sql = getSql();
  const summary = await getPaymentSummary(sql, paymentId);
  if (summary === undefined) {
    return { state: "CHECK_FAILED" };
  }
  const attempt = await findActiveAttempt(sql, paymentId);
  if (attempt === undefined) {
    return outcomeFromPaymentStatus(summary.status, summary.listing_public_id);
  }

  logPaymentEvent("verification_requested", {
    payment_id: paymentId,
    provider_order_id: attempt.provider_order_id,
  });

  // Server-to-server authority — OUTSIDE any transaction.
  let details: ProviderOrderDetails;
  try {
    details = await getPaymentProvider().getOrderDetails(attempt.provider_order_id);
  } catch (error) {
    // network/contract/auth failure: state must not move
    logPaymentEvent("verification_failed", {
      payment_id: paymentId,
      provider_order_id: attempt.provider_order_id,
      kind: error instanceof PaymentProviderError ? error.kind : "UNKNOWN",
    });
    return { state: "CHECK_FAILED" };
  }

  if (details.providerOrderId !== attempt.provider_order_id) {
    logPaymentEvent("verification_failed", {
      payment_id: paymentId,
      provider_order_id: attempt.provider_order_id,
      kind: "ORDER_IDENTITY_MISMATCH",
    });
    return { state: "CHECK_FAILED" };
  }

  logPaymentEvent("provider_status_observed", {
    payment_id: paymentId,
    provider_order_id: attempt.provider_order_id,
    provider_status: details.status,
  });

  return withTransaction(async (tx) => {
    const payment = await lockPayment(tx, paymentId);
    if (payment === undefined) {
      return { state: "CHECK_FAILED" as const };
    }
    if (payment.status === "SUCCESS" || payment.status === "REFUNDED") {
      // another verification already settled it — idempotent replay
      return outcomeFromPaymentStatus(payment.status, summary.listing_public_id);
    }
    const lockedAttempt = await findActiveAttempt(tx, paymentId);
    if (lockedAttempt === undefined || lockedAttempt.id !== attempt.id) {
      return outcomeFromPaymentStatus(payment.status, summary.listing_public_id);
    }

    if (details.status === "FullyPaid") {
      const amountMatches = details.amountMinor === Number(payment.amount_minor);
      const currencyMatches = details.currency === payment.currency;
      if (!amountMatches || !currencyMatches) {
        // provider says paid but not what we sold — never fulfill;
        // keep the attempt open for operations review
        await recordAttemptStatus(tx, lockedAttempt.id, details.status);
        logPaymentEvent("amount_currency_mismatch", {
          payment_id: paymentId,
          provider_order_id: lockedAttempt.provider_order_id,
          expected_minor: Number(payment.amount_minor),
          observed_minor: details.amountMinor,
          expected_currency: payment.currency,
          observed_currency: details.currency,
        });
        return { state: "MISMATCH" as const };
      }
      await terminalizeAttempt(tx, lockedAttempt.id, {
        providerStatus: details.status,
        succeeded: true,
      });
      await markPaymentSucceeded(tx, paymentId, details.providerTransactionId);
      logPaymentEvent("payment_succeeded", {
        payment_id: paymentId,
        provider_order_id: lockedAttempt.provider_order_id,
      });
      await insertOutboxEvent(tx, {
        eventType: "PAYMENT_SUCCEEDED",
        aggregateId: payment.listing_id ?? paymentId,
        payload: {
          payment_id: paymentId,
          listing_id: payment.listing_id,
          amount_minor: Number(payment.amount_minor),
          currency: payment.currency,
        },
      });
      await fulfillListingFee(tx, paymentId, payment.listing_id);
      return { state: "SUCCESS" as const, listingPublicId: summary.listing_public_id };
    }

    if (details.status === "Preparing") {
      await recordAttemptStatus(tx, lockedAttempt.id, details.status);
      return { state: "PENDING" as const };
    }

    if (RETRYABLE_PROVIDER_STATUSES.includes(details.status)) {
      await terminalizeAttempt(tx, lockedAttempt.id, {
        providerStatus: details.status,
        succeeded: false,
      });
      await resetPaymentToCreated(tx, paymentId);
      return { state: "RETRYABLE" as const };
    }

    if (details.status === "Refunded") {
      await terminalizeAttempt(tx, lockedAttempt.id, {
        providerStatus: details.status,
        succeeded: false,
      });
      await markPaymentRefunded(tx, paymentId);
      return { state: "REFUNDED" as const };
    }

    // Unknown provider status: never SUCCESS — record and reconcile later.
    await recordAttemptStatus(tx, lockedAttempt.id, details.status);
    logPaymentEvent("unknown_provider_status", {
      payment_id: paymentId,
      provider_order_id: lockedAttempt.provider_order_id,
      provider_status: details.status,
    });
    return { state: "PENDING" as const };
  });
}

/** Listing side of a verified LISTING_FEE success (inside the same tx). */
async function fulfillListingFee(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  paymentId: string,
  listingId: string | null,
): Promise<void> {
  if (listingId === null) {
    return;
  }
  const transitioned = await transitionListingPaymentCompleted(tx, listingId);
  if (!transitioned) {
    // listing left PAYMENT_REQUIRED through another path (e.g. admin) —
    // payment success stands; flag for operations instead of guessing
    logPaymentEvent("verification_failed", {
      payment_id: paymentId,
      kind: "LISTING_NOT_IN_PAYMENT_REQUIRED",
    });
    return;
  }
  await insertSystemStatusHistory(tx, {
    listingId,
    fromStatus: "PAYMENT_REQUIRED",
    toStatus: "PAYMENT_COMPLETED",
    reasonCode: "PAYMENT_CONFIRMED",
  });
  await insertSystemStatusHistory(tx, {
    listingId,
    fromStatus: "PAYMENT_COMPLETED",
    toStatus: "PENDING_MODERATION",
    reasonCode: "PAYMENT_CONFIRMED",
  });
  await insertOutboxEvent(tx, {
    eventType: "LISTING_ENTERED_MODERATION",
    aggregateId: listingId,
    payload: { listing_id: listingId, payment_id: paymentId, billing_type: "PAID" },
  });
  logPaymentEvent("fulfillment_completed", { payment_id: paymentId, listing_id: listingId });
}

export interface CallbackVerification {
  outcome: VerificationOutcome | { state: "UNKNOWN_ORDER" };
  listingId: string | null;
}

/**
 * Callback-side verification. The provider order id comes from an
 * untrusted query string: it is sanitized, mapped to OUR attempt
 * records (no provider call for unknown ids — this route is never a
 * probing oracle), and the mapped payment must belong to the session
 * user. Callback STATUS is never read.
 */
export async function verifyKapitalReturn(
  auth: AuthContext,
  providerOrderIdRaw: string | undefined,
): Promise<CallbackVerification> {
  const providerOrderId = (providerOrderIdRaw ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(providerOrderId)) {
    return { outcome: { state: "UNKNOWN_ORDER" }, listingId: null };
  }
  const sql = getSql();
  const attempt = await findAttemptByProviderOrder(sql, PAYMENT_PROVIDER_CODE, providerOrderId);
  if (attempt === undefined) {
    return { outcome: { state: "UNKNOWN_ORDER" }, listingId: null };
  }
  const summary = await getPaymentSummary(sql, attempt.payment_id);
  if (summary === undefined || summary.user_id !== auth.user.id) {
    // foreign/unmapped orders get the same generic answer — no
    // existence disclosure, no cross-user data
    return { outcome: { state: "UNKNOWN_ORDER" }, listingId: null };
  }
  const outcome = await verifyProviderPayment(attempt.payment_id);
  return { outcome, listingId: summary.listing_id };
}

export interface ReconciliationSummary {
  checked: number;
  succeeded: number;
  pending: number;
  retryable: number;
  refunded: number;
  mismatched: number;
  failed: number;
}

/**
 * Reconciliation over stale pending provider payments — the exact
 * same verification/fulfillment path as the callback, so there is no
 * second implementation to drift. Phase 4.16 schedules this as a job;
 * it is safe to run repeatedly and concurrently with user traffic.
 */
export async function reconcileProviderPayments(
  options: { olderThanSeconds?: number; limit?: number } = {},
): Promise<ReconciliationSummary> {
  const sql = getSql();
  const stale = await listStalePendingPayments(
    sql,
    PAYMENT_PROVIDER_CODE,
    options.olderThanSeconds ?? 300,
    options.limit ?? 50,
  );
  const summary: ReconciliationSummary = {
    checked: 0, succeeded: 0, pending: 0, retryable: 0, refunded: 0, mismatched: 0, failed: 0,
  };
  for (const payment of stale) {
    summary.checked += 1;
    const outcome = await verifyProviderPayment(payment.id);
    if (outcome.state === "SUCCESS") summary.succeeded += 1;
    else if (outcome.state === "PENDING") summary.pending += 1;
    else if (outcome.state === "RETRYABLE") summary.retryable += 1;
    else if (outcome.state === "REFUNDED") summary.refunded += 1;
    else if (outcome.state === "MISMATCH") summary.mismatched += 1;
    else summary.failed += 1;
  }
  return summary;
}
