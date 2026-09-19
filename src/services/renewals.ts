import { randomUUID } from "node:crypto";
import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { getSql, withTransaction } from "@/lib/server/db/client";
import { logPaymentEvent } from "@/lib/payments/log";
import { getOpenEditRevision } from "@/repositories/listing-edit-revisions";
import {
  lockOwnedListingForLifecycle,
  recordReactivationRequest,
} from "@/repositories/listing-lifecycle";
import {
  findOpenRenewalIntent,
  findOwnerListingForRenewal,
  getRenewalSettings,
  insertRenewalIntent,
  lockOpenRenewalIntent,
} from "@/repositories/renewals";
import { insertSellerAudit } from "@/repositories/seller-audit";
import { runProviderCheckout, type CheckoutResult } from "@/services/payment-checkout";

/**
 * Seller renewal purchases (Phase 4.16). Accepted business rule: an
 * EXPIRED listing renews for the settings-resolved fee and duration
 * (seeded 2 AZN / 30 days), keeping the SAME listing id, public id,
 * publication identity and history — renewal is NOT a new publication
 * and consumes no free-publication quota. The fee and duration are
 * snapshotted immutably onto the payment intent; later admin setting
 * changes affect only future intents.
 */

const RENEWABLE_STATUS = "EXPIRED";

export interface RenewalStateDto {
  listingId: string;
  publicId: string;
  status: string;
  eligible: boolean;
  title: string;
  currentExpiresAt: string | null;
  /** CURRENT settings offer (what a NEW purchase would snapshot). */
  offer: { amountMinor: number; currency: string; durationDays: number } | null;
  /** Open intent, if one exists — ITS snapshot is what will be charged. */
  openIntent: {
    status: string;
    amountMinor: number;
    currency: string;
    durationDays: number | null;
  } | null;
}

function title(row: { brand: string | null; model: string | null; year: number | null }): string {
  return [row.brand, row.model, row.year].filter((part) => part !== null).join(" ") || "Elan";
}

export async function renewalState(
  auth: AuthContext,
  listingId: string,
): Promise<RenewalStateDto> {
  const sql = getSql();
  const listing = await findOwnerListingForRenewal(sql, listingId, auth.user.id);
  if (listing === undefined) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  const settings = await getRenewalSettings(sql);
  const openIntent = await findOpenRenewalIntent(sql, listingId);
  // O.12 Stage E: an open edit revision makes renewal ineligible — the
  // sealed order is edit → moderation → renewal (the direct URL then
  // lands on the existing "renewal unavailable" state, no new screen)
  const openEdit = await getOpenEditRevision(sql, listingId);
  return {
    listingId: listing.id,
    publicId: listing.public_id,
    status: listing.status,
    eligible:
      listing.status === RENEWABLE_STATUS && settings !== null && openEdit === undefined,
    title: title(listing),
    currentExpiresAt: listing.current_expires_at?.toISOString() ?? null,
    offer:
      settings === null
        ? null
        : { amountMinor: settings.feeMinor, currency: "AZN", durationDays: settings.durationDays },
    openIntent:
      openIntent === undefined
        ? null
        : {
            status: openIntent.status,
            amountMinor: Number(openIntent.amount_minor),
            currency: openIntent.currency,
            durationDays: openIntent.renewal_duration_days,
          },
  };
}

/**
 * Creates (or reuses) THE open renewal intent for the listing and
 * runs the ONE accepted Kapital checkout core. Concurrency: the
 * partial unique index guarantees a single open RENEWAL intent per
 * listing, so 10 simultaneous requests converge on one payment and —
 * via the initiation claim inside runProviderCheckout — one provider
 * order. An existing open intent keeps ITS snapshot even if settings
 * changed meanwhile.
 */
export async function createRenewalCheckout(
  auth: AuthContext,
  listingId: string,
): Promise<CheckoutResult> {
  const sql = getSql();
  const listing = await findOwnerListingForRenewal(sql, listingId, auth.user.id);
  if (listing === undefined) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  const settings = await getRenewalSettings(sql);
  if (settings === null) {
    throw new ApiError(
      "LISTING_PAYMENT_CONFIGURATION_ERROR",
      "Renewal pricing is not configured.",
    );
  }

  const intent = await withTransaction(async (tx) => {
    // Sealed lock order for renewal: payments row first, listing row
    // second — the same order verified fulfillment uses (payment lock →
    // listing lock), so checkout and a concurrent callback can never
    // deadlock. Serialization against edit creation/submission comes
    // from the listing lock below.
    const existing = await lockOpenRenewalIntent(tx, listingId);

    // O.12 Stage E hardening — eligibility is decided UNDER the listing
    // row lock (the same first lock every edit-revision writer takes),
    // so a concurrent edit creation/submission and a renewal checkout
    // serialize deterministically and the winner's state is what the
    // loser sees. No payment row, provider order, or period can exist
    // before these guards pass.
    const locked = await lockOwnedListingForLifecycle(tx, listingId, auth.user.id);
    if (locked === undefined || locked.deleted_at !== null || locked.status === "DELETED") {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    if (locked.status !== RENEWABLE_STATUS) {
      throw new ApiError(
        "PAYMENT_NOT_REQUIRED",
        "Only expired listings can be renewed.",
      );
    }
    // sealed order: edit → moderation → renewal. Any OPEN revision
    // (EDIT_DRAFT / PENDING_MODERATION / CORRECTION_REQUIRED) blocks
    // renewal checkout server-side — UI hiding alone is not trusted.
    const openEdit = await getOpenEditRevision(tx, listingId);
    if (openEdit !== undefined) {
      throw new ApiError(
        "LISTING_LIFECYCLE_CONFLICT",
        "Renewal is unavailable while an edit revision is open.",
        { details: { edit_status: openEdit.status } },
      );
    }
    // Deactivated seller renewing = the activation intent (sealed §9):
    // record it here (coalesce keeps the first ask) so a verified
    // renewal can finalize reactivation without a second Aktiv et.
    if (locked.seller_deactivated_at !== null && locked.seller_reactivation_requested_at === null) {
      const recorded = await recordReactivationRequest(tx, {
        listingId,
        expectedRevision: locked.revision,
      });
      if (recorded) {
        await insertSellerAudit(tx, {
          actorUserId: auth.user.id,
          action: "LISTING_SELLER_REACTIVATION_REQUESTED",
          entityId: listingId,
          afterData: { via: "RENEWAL_CHECKOUT" },
        });
      }
    }

    if (existing !== undefined) {
      return existing; // snapshot honored — never re-priced
    }
    const inserted = await insertRenewalIntent(tx, {
      userId: auth.user.id,
      listingId,
      amountMinor: settings.feeMinor,
      currency: "AZN",
      durationDays: settings.durationDays,
      idempotencyKey: `renewal:${listingId}:${randomUUID()}`,
    });
    if (inserted !== null) {
      logPaymentEvent("checkout_requested", {
        payment_id: inserted.id,
        listing_id: listingId,
        purpose: "RENEWAL",
        duration_days: settings.durationDays,
      });
      return inserted;
    }
    // lost the unique-index race — the concurrent winner is the
    // intent. Read it WITHOUT locking: we already hold the listing
    // lock, and requesting the payments lock here would invert the
    // sealed payments→listing order against fresh arrivals (deadlock).
    // The snapshot fields are immutable once inserted, so a committed
    // read is sufficient; runProviderCheckout has its own initiation
    // claim for provider-order arbitration.
    const winner = await findOpenRenewalIntent(tx, listingId);
    if (winner !== undefined) {
      return winner;
    }
    throw new ApiError(
      "PAYMENT_CHECKOUT_UNAVAILABLE",
      "Payment initiation is temporarily unavailable.",
    );
  });

  return runProviderCheckout({
    paymentId: intent.id,
    amountMinor: Number(intent.amount_minor),
    currency: intent.currency,
    description: `AVTOSH.AZ elan ${listing.public_id} yenilenme haqqi`,
  });
}
