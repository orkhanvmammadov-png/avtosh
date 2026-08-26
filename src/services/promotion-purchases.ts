import { randomUUID } from "node:crypto";
import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { logPaymentEvent } from "@/lib/payments/log";
import { getSql, withTransaction } from "@/lib/server/db/client";
import {
  cancelPromotionIntent,
  findActivePackage,
  findPromotableListing,
  insertPromotionIntent,
  listActivePromotionPackages,
  lockOpenPromotionIntent,
  ownerPromotionState,
} from "@/repositories/promotions";
import {
  runProviderCheckout,
  type CheckoutResult,
} from "@/services/payment-checkout";

/**
 * PREMIUM/BOOST purchases (Phase 4.13) on the accepted Kapital
 * foundation. The browser sends only listing + type + package id;
 * the server resolves price/currency/duration from the enabled
 * package row and snapshots them into an immutable payment intent —
 * a later package-price change never alters an existing intent
 * (the LISTING_FEE invariant, reused).
 *
 * Intent idempotency: the partial unique index (one OPEN promotion
 * intent — CREATED or PENDING — per listing+type) collapses double
 * clicks, repeats, and concurrent POSTs into a single intent whose
 * checkout is reused. A different-package repeat replaces an
 * UNSTARTED (CREATED) intent — no provider order exists, so nothing
 * payable is discarded — but while a checkout is in flight (PENDING)
 * the package cannot be switched (409 PROMOTION_PAYMENT_PENDING: the
 * open hosted-payment page could still be paid). The moment an
 * intent reaches a terminal state, the next same-type purchase opens
 * a fresh intent — legitimate sequential purchases are never
 * blocked, and same-type concurrent unpaid intents are structurally
 * impossible (first layer of the lost-update protection).
 */

export const PROMOTION_TYPES = ["PREMIUM", "BOOST"] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export interface PromotionPackageDto {
  id: string;
  type: string;
  name: string;
  durationDays: number;
  priceMinor: number;
  currency: string;
}

export async function promotionPackages(): Promise<PromotionPackageDto[]> {
  const rows = await listActivePromotionPackages(getSql());
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    durationDays: row.duration_days,
    priceMinor: Number(row.price_minor),
    currency: row.currency,
  }));
}

/** Owner surface: current promotion validity per type. */
export async function listingPromotionState(
  auth: AuthContext,
  listingId: string,
): Promise<{ premiumUntil: string | null; boostUntil: string | null; promotable: boolean }> {
  const sql = getSql();
  const listing = await findPromotableListing(sql, listingId, auth.user.id);
  if (listing === undefined) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  const state = await ownerPromotionState(sql, listingId);
  return {
    premiumUntil: state.premium_until?.toISOString() ?? null,
    boostUntil: state.boost_until?.toISOString() ?? null,
    promotable: listing.promotable,
  };
}

/**
 * Creates/reuses the promotion payment intent and returns the
 * checkout URL through the shared Kapital core. Fully
 * server-authoritative: eligibility, price, currency, duration.
 */
export async function createPromotionCheckout(
  auth: AuthContext,
  listingId: string,
  input: { type: PromotionType; packageId: string },
): Promise<CheckoutResult> {
  const sql = getSql();
  const listing = await findPromotableListing(sql, listingId, auth.user.id);
  if (listing === undefined) {
    // missing and foreign listings are indistinguishable
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  if (!listing.promotable) {
    throw new ApiError(
      "PROMOTION_NOT_AVAILABLE",
      "Promotions are only available for active listings.",
    );
  }
  const pkg = await findActivePackage(sql, input.packageId, input.type);
  if (pkg === undefined) {
    throw new ApiError("PROMOTION_PACKAGE_NOT_FOUND", "Promotion package not found.");
  }

  const intent = await withTransaction(async (tx) => {
    const existing = await lockOpenPromotionIntent(tx, listingId, input.type);
    if (existing !== undefined) {
      if (existing.promotion_package_id === pkg.id) {
        return existing; // same intended purchase — reuse its checkout
      }
      if (existing.status !== "CREATED") {
        // a checkout for another package is in flight; its HPP could
        // still be paid — never silently discard it
        throw new ApiError(
          "PROMOTION_PAYMENT_PENDING",
          "A promotion payment for this listing is already in progress.",
        );
      }
      // unstarted intent for another package: replace (no provider
      // order exists yet, so nothing payable is discarded)
      await cancelPromotionIntent(tx, existing.id);
    }
    const inserted = await insertPromotionIntent(tx, {
      userId: auth.user.id,
      listingId,
      type: input.type,
      packageId: pkg.id,
      amountMinor: Number(pkg.price_minor),
      currency: pkg.currency,
      durationDays: pkg.duration_days,
      idempotencyKey: `promotion:${input.type}:${listingId}:${randomUUID()}`,
    });
    if (inserted !== null) {
      logPaymentEvent("promotion_purchase_created", {
        payment_id: inserted.id,
        listing_id: listingId,
        promotion_type: input.type,
        duration_days: pkg.duration_days,
      });
      return inserted;
    }
    // lost the unique-index race — the concurrent winner is the intent
    const winner = await lockOpenPromotionIntent(tx, listingId, input.type);
    if (winner !== undefined) {
      return winner;
    }
    throw new ApiError("PAYMENT_CHECKOUT_UNAVAILABLE", "Payment initiation is temporarily unavailable.");
  });

  return runProviderCheckout({
    paymentId: intent.id,
    amountMinor: Number(intent.amount_minor),
    currency: intent.currency,
    description: `AVTOSH.AZ elan ${listing.public_id} ${input.type === "PREMIUM" ? "Premium" : "Boost"} ${pkg.duration_days} gun`,
  });
}
