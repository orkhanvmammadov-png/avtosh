import type { Sql } from "@/lib/server/db/client";
import {
  insertCampaignPromotionPeriod,
  insertCampaignGrantAudit,
  lockListingForPromotion,
} from "@/repositories/promotions";
import {
  findOpenPremiumCampaign,
  type PremiumCampaignRow,
} from "@/repositories/premium-campaigns";
import { insertOutboxEvent } from "@/repositories/listing-publications";

/**
 * O.16 — complimentary Premium campaign grants.
 *
 * One grant path for BOTH the explicit backfill and the
 * approval-time enrollment hook:
 * - the listing promotion lock is taken first (the same lock paid
 *   checkout fulfillment takes), so grants, purchases and concurrent
 *   approvals serialize per listing;
 * - the insert queues after the latest unexpired PREMIUM period
 *   (paid or complimentary) — paid history is never touched, and a
 *   later paid purchase queues after the grant via the same rule;
 * - at-most-once per listing per campaign comes from the partial
 *   unique index (insert ... on conflict do nothing): re-runs,
 *   repeated moderation callbacks and concurrent calls can never
 *   create a duplicate, and a skipped insert performs no audit/outbox
 *   writes;
 * - a grant NEVER changes listing status or visibility: an expired,
 *   deactivated, sold or suspended listing stays nonpublic because
 *   every public surface filters by publicVisible(), not by
 *   promotions.
 */
export async function grantCampaignPremium(
  tx: Sql,
  input: {
    listingId: string;
    campaign: PremiumCampaignRow;
    grantedVia: "BACKFILL" | "APPROVAL";
  },
): Promise<{ granted: boolean; endsAt?: Date }> {
  await lockListingForPromotion(tx, input.listingId);
  const period = await insertCampaignPromotionPeriod(tx, {
    listingId: input.listingId,
    campaignId: input.campaign.id,
    grantDays: input.campaign.grant_days,
  });
  if (period === undefined) {
    return { granted: false }; // already granted by this campaign
  }
  await insertCampaignGrantAudit(tx, {
    listingId: input.listingId,
    campaignId: input.campaign.id,
    campaignCode: input.campaign.code,
    grantedVia: input.grantedVia,
    startsAt: period.starts_at,
    endsAt: period.ends_at,
  });
  await insertOutboxEvent(tx, {
    eventType: "PROMOTION_ACTIVATED",
    aggregateId: input.listingId,
    payload: {
      listing_id: input.listingId,
      promotion_type: "PREMIUM",
      source: "CAMPAIGN",
      campaign_code: input.campaign.code,
      granted_via: input.grantedVia,
      starts_at: period.starts_at.toISOString(),
      ends_at: period.ends_at.toISOString(),
      queued: period.status === "SCHEDULED",
    },
  });
  return { granted: true, endsAt: period.ends_at };
}

/**
 * Approval-time enrollment: inside the approve transaction, AFTER the
 * listing transitioned to ACTIVE. A failure to look up the campaign
 * must never fail an approval — but the grant itself, once a campaign
 * is open, participates in the approval transaction (either both
 * commit or neither). Returns quietly when no window is open.
 */
export async function enrollApprovedListingInOpenCampaign(
  tx: Sql,
  listingId: string,
): Promise<void> {
  const campaign = await findOpenPremiumCampaign(tx);
  if (campaign === undefined) {
    return;
  }
  await grantCampaignPremium(tx, { listingId, campaign, grantedVia: "APPROVAL" });
}
