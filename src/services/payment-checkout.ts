import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { appOrigin } from "@/lib/config/kapital";
import { minorToMajorString } from "@/lib/payments/money";
import { logPaymentEvent } from "@/lib/payments/log";
import { getSql, withTransaction } from "@/lib/server/db/client";
import {
  claimInitiation,
  completeInitiation,
  findActiveAttempt,
  findAttemptByProviderOrder,
  findListingFeePayment,
  getPaymentSummary,
  insertSystemStatusHistory,
  lockPayment,
  listStalePendingPayments,
  markPaymentPending,
  markPaymentRefunded,
  markPaymentSucceeded,
  recordAttemptStatus,
  terminalizeAttempt,
  transitionListingPaymentCompleted,
  type AttemptRow,
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
 * Verification and fulfillment are SESSION-INDEPENDENT — a paid order
 * is fulfilled even when the seller's AVTOSH session is gone; the
 * session only decides how much the RESULT PAGE may personalize.
 *
 * Provider network calls always happen OUTSIDE database transactions.
 * Checkout initiation uses a durable DB claim (an INITIATING attempt
 * row guarded by the one-active partial unique index) taken BEFORE
 * the external POST /order, so N concurrent requests produce at most
 * ONE provider createOrder side effect — no orphan provider orders.
 */

const CHECKOUT_ELIGIBLE_STATUSES = ["CREATED", "PENDING"];

/**
 * Only statuses with direct official-contract evidence are mapped
 * (Preparing / FullyPaid / Refunded). Everything else — including
 * "Cancelled"/"Declined"/"Expired", whose terminal semantics are NOT
 * confirmed by the official documentation — takes the UNKNOWN path:
 * recorded, never SUCCESS, never fulfilled, no automatic re-arm,
 * left pending for reconciliation/operations.
 */

/** How long an initiation claim may sit unfilled before recovery. */
const INITIATION_LEASE_SECONDS = 120;
/** Bounded wait for a concurrent initiation to finish (16 × 250ms). */
const INITIATION_WAIT_POLLS = 16;
const INITIATION_WAIT_INTERVAL_MS = 250;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface CheckoutResult {
  checkoutUrl: string;
}

function checkoutUnavailable(): ApiError {
  return new ApiError(
    "PAYMENT_CHECKOUT_UNAVAILABLE",
    "Payment initiation is temporarily unavailable.",
  );
}

function reuseUrl(attempt: AttemptRow): CheckoutResult | null {
  if (attempt.provider_order_id !== null && attempt.hpp_url !== null && attempt.hpp_secret !== null) {
    return {
      checkoutUrl: buildHppRedirect(attempt.hpp_url, attempt.provider_order_id, attempt.hpp_secret),
    };
  }
  return null;
}

function claimIsStale(attempt: AttemptRow): boolean {
  return (
    attempt.provider_order_id === null &&
    Date.now() - attempt.created_at.getTime() > INITIATION_LEASE_SECONDS * 1000
  );
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

  // Phase 1 — atomically obtain the initiation claim (or learn who has it).
  const claim = await withTransaction(async (tx) => {
    const payment = await lockPayment(tx, context.payment_id);
    if (payment === undefined || !CHECKOUT_ELIGIBLE_STATUSES.includes(payment.status)) {
      throw new ApiError("PAYMENT_NOT_REQUIRED", "The listing has no payable fee right now.");
    }
    const active = await findActiveAttempt(tx, payment.id);
    if (active !== undefined) {
      const reusable = reuseUrl(active);
      if (reusable !== null) {
        return { kind: "reuse" as const, result: reusable };
      }
      if (claimIsStale(active)) {
        // Recovery: the claim never got an order persisted (crash or
        // ambiguous POST). Any order Kapital MIGHT have created is
        // unpayable — its password never left this process — so it can
        // only expire unpaid. Record the ambiguity honestly, then take
        // a fresh claim.
        await terminalizeAttempt(tx, active.id, {
          providerStatus: "InitiationAbandoned",
          succeeded: false,
        });
        logPaymentEvent("provider_order_orphaned", {
          payment_id: payment.id,
          reason: "initiation_lease_expired",
        });
        const fresh = await claimInitiation(tx, payment.id, PAYMENT_PROVIDER_CODE);
        if (fresh === null) {
          return { kind: "wait" as const };
        }
        return { kind: "create" as const, attemptId: fresh.id, payment };
      }
      // someone else is initiating right now — wait for their result
      return { kind: "wait" as const };
    }
    const fresh = await claimInitiation(tx, payment.id, PAYMENT_PROVIDER_CODE);
    if (fresh === null) {
      return { kind: "wait" as const };
    }
    return { kind: "create" as const, attemptId: fresh.id, payment };
  });

  if (claim.kind === "reuse") {
    return claim.result;
  }

  if (claim.kind === "wait") {
    // Bounded wait on the real signal (the claim row filling in) —
    // this request NEVER calls the provider.
    for (let poll = 0; poll < INITIATION_WAIT_POLLS; poll += 1) {
      await delay(INITIATION_WAIT_INTERVAL_MS);
      const attempt = await findActiveAttempt(sql, context.payment_id);
      if (attempt === undefined) {
        break; // initiator failed and released — client may retry
      }
      const reusable = reuseUrl(attempt);
      if (reusable !== null) {
        return reusable;
      }
    }
    throw checkoutUnavailable();
  }

  // Phase 2 — this request owns the claim: ONE provider call, no locks held.
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
    const kind = error instanceof PaymentProviderError ? error.kind : "UNKNOWN";
    // Release the claim with an honest terminal marker. NETWORK
    // outcomes are ambiguous — Kapital may have created an order —
    // but that order is unpayable (its password was never received),
    // so it can only expire; a fresh user-initiated attempt is safe.
    await withTransaction(async (tx) => {
      await terminalizeAttempt(tx, claim.attemptId, {
        providerStatus: kind === "NETWORK" ? "InitiationAmbiguous" : "InitiationFailed",
        succeeded: false,
      });
    });
    logPaymentEvent("checkout_initiation_failed", {
      payment_id: context.payment_id,
      kind,
    });
    throw checkoutUnavailable();
  }

  // Phase 3 — persist the created order into the claim.
  return withTransaction(async (tx) => {
    await lockPayment(tx, context.payment_id);
    await completeInitiation(tx, claim.attemptId, {
      providerOrderId: order.providerOrderId,
      hppUrl: order.hppUrl,
      hppSecret: order.hppSecret,
      providerStatus: order.status,
    });
    await markPaymentPending(tx, context.payment_id, PAYMENT_PROVIDER_CODE, order.providerOrderId);
    logPaymentEvent("provider_order_created", {
      payment_id: context.payment_id,
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
 * with exactly one fulfillment. Requires NO AVTOSH session.
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
  if (attempt.provider_order_id === null) {
    return { state: "PENDING" }; // initiation still in progress
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

    if (details.status === "Refunded") {
      await terminalizeAttempt(tx, lockedAttempt.id, {
        providerStatus: details.status,
        succeeded: false,
      });
      await markPaymentRefunded(tx, paymentId);
      return { state: "REFUNDED" as const };
    }

    // UNKNOWN path — includes "Cancelled"/"Declined"/"Expired", whose
    // terminal semantics are not confirmed by the official contract:
    // record, never SUCCESS, never fulfill, no automatic re-arm; the
    // payment stays PENDING for reconciliation/operations.
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

export type CallbackView =
  | { view: "OWNER"; outcome: VerificationOutcome; listingId: string | null }
  | { view: "GENERIC" };

/**
 * Callback handling with PROCESSING separated from PERSONALIZATION.
 *
 * Processing (verification + fulfillment) runs for every structurally
 * valid provider order id that maps to one of OUR attempts —
 * regardless of session state. A paid seller whose AVTOSH session
 * expired still gets fulfilled.
 *
 * Personalization: only a session belonging to the payment owner sees
 * the real outcome. Everyone else — anonymous, foreign session,
 * unknown id, malformed id — receives the SAME generic view, so the
 * callback can never be used to enumerate order ids or learn whether
 * an arbitrary id belongs to an AVTOSH user. Unknown ids trigger no
 * provider call (never a probing oracle).
 */
export async function handleKapitalCallback(
  auth: AuthContext | null,
  providerOrderIdRaw: string | undefined,
): Promise<CallbackView> {
  const providerOrderId = (providerOrderIdRaw ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(providerOrderId)) {
    return { view: "GENERIC" };
  }
  const sql = getSql();
  const attempt = await findAttemptByProviderOrder(sql, PAYMENT_PROVIDER_CODE, providerOrderId);
  if (attempt === undefined) {
    return { view: "GENERIC" };
  }
  // Session-independent authority: verify + fulfill idempotently.
  const outcome = await verifyProviderPayment(attempt.payment_id);
  if (auth === null) {
    return { view: "GENERIC" };
  }
  const summary = await getPaymentSummary(sql, attempt.payment_id);
  if (summary === undefined || summary.user_id !== auth.user.id) {
    return { view: "GENERIC" };
  }
  return { view: "OWNER", outcome, listingId: summary.listing_id };
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
