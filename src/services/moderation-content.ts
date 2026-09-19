import { groupEquipment } from "@/lib/marketplace/equipment";
import type { Sql } from "@/lib/server/db/client";
import { listFeatureRowsByIds, type FeatureNameRow } from "@/repositories/listings";
import type { ListingImageDto } from "@/services/listing-dto";

/**
 * O.13 Stage A — server-authoritative moderation read model. One
 * shared full-content shape covers what the moderator reviews for
 * both moderation types: for NEW_LISTING the pending listing content
 * itself, for LISTING_EDIT the seller-proposed revision content
 * (12-api-state-contracts: sellerSubmitted; moderatorAdjusted does
 * not exist until Stage B and is never faked). Labels, grouped O.11
 * equipment, image order and primary state are resolved server-side —
 * the UI never reconstructs them from ids.
 */

export interface ModerationFeatureDto {
  id: string;
  label: string;
  /** Stage A read model lists the selected set only, so always true;
      the field keeps the Stage B per-item contract shape. */
  selected: boolean;
}

export interface ModerationFeatureGroupDto {
  code: string;
  label: string;
  features: ModerationFeatureDto[];
}

/** Full seller marketplace content as reviewed by staff. contactPhone
    is the full authorized marketplace contact value — staff-only. */
export interface ModerationContentDto {
  category: string;
  brandName: string | null;
  modelName: string | null;
  year: number | null;
  priceMinor: number | null;
  currency: string;
  mileage: number | null;
  engineCc: number | null;
  fuelType: string | null;
  transmission: string | null;
  bodyType: string | null;
  driveType: string | null;
  motorcycleType: string | null;
  color: string | null;
  cityName: string | null;
  creditAvailable: boolean;
  barterAvailable: boolean;
  noAccident: boolean | null;
  notRepainted: boolean | null;
  description: string | null;
  sellerName: string | null;
  contactPhone: string | null;
  featureGroups: ModerationFeatureGroupDto[];
  images: ListingImageDto[];
}

/** Groups already-resolved feature rows by the sealed O.11 groups
    (approved order, trailing Digər fallback for legacy codes). */
export function buildFeatureGroupsFromRows(rows: FeatureNameRow[]): ModerationFeatureGroupDto[] {
  return groupEquipment(
    rows.map((row) => ({ id: row.id, name: row.name_az, group: row.group_code })),
  ).map((group) => ({
    code: group.code,
    label: group.label,
    features: group.items.map((item) => ({ id: item.id, label: item.name, selected: true })),
  }));
}

/** ONE batch lookup for a selection — never a per-feature query. */
export async function buildFeatureGroups(
  sql: Sql,
  featureIds: readonly string[],
): Promise<ModerationFeatureGroupDto[]> {
  return buildFeatureGroupsFromRows(await listFeatureRowsByIds(sql, featureIds));
}
