import { generateSessionToken, hashSessionToken } from "@/auth/otp-crypto";
import { ApiError } from "@/lib/api/errors";
import {
  GUEST_MAX_LIVE_DRAFTS,
  GUEST_SESSION_TTL_SECONDS,
  guestDraftLimits,
  guestDraftsEnabled,
} from "@/lib/config/guest-drafts";
import { getSql, withTransaction } from "@/lib/server/db/client";
import { findActiveCategoryByCode } from "@/repositories/catalog";
import {
  countGuestDraftsForIpSince,
  countGuestSessionsForIpSince,
  countLiveGuestDrafts,
  createGuestDraftListing,
  findActiveGuestSessionByTokenHash,
  getGuestListing,
  insertGuestSession,
  lockActiveGuestSession,
  touchGuestSessionLastSeen,
  updateGuestDraftListing,
} from "@/repositories/guest-drafts";
import { replaceListingFeatures, removeIncompatibleListingFeatures } from "@/repositories/listings";
import {
  buildOwnerListingDto,
  resolveDraftUpdateSet,
} from "@/services/listing-drafts";
import type { OwnerListingDto } from "@/services/listing-dto";
import type { DraftPatchInput } from "@/validators/listings";

/**
 * Guest draft service (deferred-login PR A): anonymous DRAFT creation,
 * read and PATCH, scoped exclusively by a server-owned opaque guest
 * capability. FAIL-CLOSED behind GUEST_DRAFTS_ENABLED; a disabled
 * feature, a missing/expired/foreign capability and an unknown listing
 * all produce the SAME LISTING_NOT_FOUND — no enumeration oracle.
 *
 * Deliberately absent here (later PRs, per the phased plan): image
 * uploads (listing_image_uploads.user_id is NOT NULL and its queries
 * are user-scoped — guest uploads need their own schema/authorization
 * design), OTP, user creation, claiming, submission, payments.
 */

function notFound(): ApiError {
  return new ApiError("LISTING_NOT_FOUND", "Listing not found.");
}

function assertEnabled(): void {
  if (!guestDraftsEnabled()) {
    throw notFound();
  }
}

export interface GuestSessionContext {
  sessionId: string;
}

/** Resolves a presented guest token to an unexpired session, or null. */
export async function resolveGuestSession(
  token: string | null,
): Promise<GuestSessionContext | null> {
  assertEnabled();
  if (token === null || token.length === 0) {
    return null;
  }
  const sql = getSql();
  const row = await findActiveGuestSessionByTokenHash(sql, hashSessionToken(token));
  if (row === undefined) {
    return null;
  }
  await touchGuestSessionLastSeen(sql, row.id);
  return { sessionId: row.id };
}

export interface GuestDraftCreationResult {
  listing: OwnerListingDto;
  /** Present only when a NEW capability was minted for this response. */
  issuedToken: string | null;
}

/**
 * Creates a guest draft, minting a capability when the caller has
 * none. The counts and the inserts they guard run in ONE transaction
 * serialized per client IP by a transaction-scoped advisory lock, so
 * concurrent requests from the same IP cannot exceed the hourly
 * session/draft caps (lock order: advisory IP lock → session row).
 * Requests with no derivable client IP carry no per-IP brake — the
 * per-session live-draft cap (enforced under the session row lock)
 * and the fixed session lifetime still bound them.
 */
export async function createGuestDraft(input: {
  presentedToken: string | null;
  ipHash: string | null;
  categoryCode: string;
}): Promise<GuestDraftCreationResult> {
  assertEnabled();
  const limits = guestDraftLimits();
  const hourAgo = new Date(Date.now() - 3_600_000);

  const existing = await resolveGuestSession(input.presentedToken);

  const category = await findActiveCategoryByCode(input.categoryCode);
  if (category === undefined) {
    throw new ApiError(
      "LISTING_INVALID_CATALOG_SELECTION",
      "Unknown or inactive category.",
    );
  }

  const rateLimited = (): ApiError =>
    new ApiError("GUEST_RATE_LIMITED", "Too many requests. Try again later.");

  const { listing, issuedToken } = await withTransaction(async (tx) => {
    if (input.ipHash !== null) {
      // Serializes every same-IP create across connections for the
      // rest of this transaction; released automatically at commit or
      // rollback. hashtextextended collisions across distinct IPs only
      // over-serialize — they never relax a cap.
      await tx`
        select pg_advisory_xact_lock(hashtextextended(${"guest_ip:" + input.ipHash}, 0))
      `;
      if (
        existing === null &&
        (await countGuestSessionsForIpSince(tx, input.ipHash, hourAgo)) >=
          limits.sessionsPerIpPerHour
      ) {
        throw rateLimited();
      }
      if (
        (await countGuestDraftsForIpSince(tx, input.ipHash, hourAgo)) >=
        limits.draftsPerIpPerHour
      ) {
        throw rateLimited();
      }
    }

    let token: string | null = null;
    let sessionId: string;
    if (existing !== null) {
      const locked = await lockActiveGuestSession(tx, existing.sessionId);
      if (locked === undefined) {
        throw notFound(); // expired between resolution and creation
      }
      sessionId = existing.sessionId;
    } else {
      token = generateSessionToken();
      const session = await insertGuestSession(tx, {
        tokenHash: hashSessionToken(token),
        ipHash: input.ipHash,
        expiresAt: new Date(Date.now() + GUEST_SESSION_TTL_SECONDS * 1000),
      });
      sessionId = session.id; // brand-new row: invisible to others until commit
    }

    if ((await countLiveGuestDrafts(tx, sessionId)) >= GUEST_MAX_LIVE_DRAFTS) {
      throw new ApiError(
        "GUEST_DRAFT_LIMIT",
        `At most ${GUEST_MAX_LIVE_DRAFTS} unfinished guest listings are allowed.`,
      );
    }
    return {
      listing: await createGuestDraftListing(tx, sessionId, category.id),
      issuedToken: token,
    };
  });

  return { listing: await buildOwnerListingDto(listing), issuedToken };
}

export async function getGuestDraftDto(
  session: GuestSessionContext | null,
  listingId: string,
): Promise<OwnerListingDto> {
  assertEnabled();
  if (session === null) {
    throw notFound();
  }
  const listing = await getGuestListing(getSql(), listingId, session.sessionId);
  if (listing === undefined) {
    throw notFound();
  }
  return buildOwnerListingDto(listing);
}

/**
 * Guest draft PATCH: the exact catalog validation, revision check and
 * dependent-field clearing of the authenticated path (shared
 * resolveDraftUpdateSet), applied through the guest-scoped guarded
 * update.
 */
export async function updateGuestDraft(
  session: GuestSessionContext | null,
  listingId: string,
  patch: DraftPatchInput,
): Promise<OwnerListingDto> {
  assertEnabled();
  if (session === null) {
    throw notFound();
  }
  const sql = getSql();
  const listing = await getGuestListing(sql, listingId, session.sessionId);
  if (listing === undefined) {
    throw notFound();
  }

  const { set, categoryChanged, targetCategoryId } = await resolveDraftUpdateSet(
    listing,
    patch,
  );

  const updated = await withTransaction(async (tx) => {
    const applied = await updateGuestDraftListing(tx, {
      listingId,
      sessionId: session.sessionId,
      expectedRevision: patch.expected_revision,
      // Same guarded, revision-bumping shape as the owner path, with a
      // no-op column when the patch resolved to nothing.
      set: Object.keys(set).length > 0 ? set : { status: listing.status },
    });
    if (!applied) {
      return false;
    }
    if (patch.feature_ids !== undefined) {
      await replaceListingFeatures(tx, listingId, patch.feature_ids);
    } else if (categoryChanged) {
      await removeIncompatibleListingFeatures(tx, listingId, targetCategoryId);
    }
    return true;
  });

  if (!updated) {
    // Ownership was proven above; guest listings are DRAFT by CHECK,
    // so a guarded-update miss here is a stale revision (or a session
    // that expired mid-request — reload makes that a clean NOT_FOUND).
    const current = await getGuestListing(sql, listingId, session.sessionId);
    if (current === undefined) {
      throw notFound();
    }
    throw new ApiError(
      "LISTING_REVISION_CONFLICT",
      "The draft was modified by another request. Reload and retry.",
      { details: { current_revision: current.revision } },
    );
  }

  const fresh = await getGuestListing(sql, listingId, session.sessionId);
  if (fresh === undefined) {
    throw notFound();
  }
  return buildOwnerListingDto(fresh);
}
