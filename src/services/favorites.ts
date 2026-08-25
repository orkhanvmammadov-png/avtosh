import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { getSql } from "@/lib/server/db/client";
import {
  addFavorite,
  findVisibleListingByPublicId,
  isFavorited,
  listFavoriteCards,
  listFavoritePublicIds,
  removeFavoriteByPublicId,
} from "@/repositories/favorites";
import { signPublicImage } from "@/services/marketplace";

/**
 * Buyer favorites: server-authorized, idempotent, public-id contract.
 * Adding requires a currently visible listing (favoriting a hidden
 * listing would leak its existence); removal always works; saved
 * listings that later leave the public marketplace stay in the list
 * flagged inactive.
 */

export interface FavoriteCardDto {
  publicId: string;
  category: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  priceMinor: number | null;
  currency: string;
  mileage: number | null;
  city: string | null;
  primaryImageUrl: string | null;
  publishedAt: string | null;
  favoritedAt: string;
  isActive: boolean;
}

export async function addFavoriteByPublicId(
  auth: AuthContext,
  publicId: number,
): Promise<{ favorited: true }> {
  const sql = getSql();
  const listing = await findVisibleListingByPublicId(sql, publicId);
  if (listing === undefined) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  await addFavorite(sql, auth.user.id, listing.id); // idempotent
  return { favorited: true };
}

export async function removeFavorite(
  auth: AuthContext,
  publicId: number,
): Promise<{ favorited: false }> {
  await removeFavoriteByPublicId(getSql(), auth.user.id, publicId); // idempotent
  return { favorited: false };
}

export async function myFavoriteCards(auth: AuthContext): Promise<FavoriteCardDto[]> {
  const rows = await listFavoriteCards(getSql(), auth.user.id);
  return Promise.all(
    rows.map(async (row) => ({
      publicId: row.public_id,
      category: row.category,
      brand: row.brand,
      model: row.model,
      year: row.year,
      priceMinor: row.price_minor === null ? null : Number(row.price_minor),
      currency: row.currency,
      mileage: row.mileage,
      city: row.city,
      primaryImageUrl: row.is_active ? await signPublicImage(row.primary_image_path) : null,
      publishedAt: row.published_at?.toISOString() ?? null,
      favoritedAt: row.favorited_at.toISOString(),
      isActive: row.is_active,
    })),
  );
}

export async function myFavoritePublicIds(auth: AuthContext): Promise<string[]> {
  return listFavoritePublicIds(getSql(), auth.user.id);
}

export async function isListingFavorited(userId: string, listingId: string): Promise<boolean> {
  return isFavorited(getSql(), userId, listingId);
}
