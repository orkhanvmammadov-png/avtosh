import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { getSql, withTransaction } from "@/lib/server/db/client";
import {
  adminListingContext,
  adminPaymentAttempts,
  dashboardCounts,
  getAdminUser,
  grantRole,
  insertAdminAudit,
  listAdminCatalog,
  listAdminListings,
  listAdminPackages,
  listAdminPayments,
  listAudit,
  listReports,
  listSettings,
  listStaffUsers,
  listUsers,
  lockListingForAdmin,
  lockUser,
  resolveReport,
  revokeRole,
  setCatalogActive,
  setUserBlocked,
  updateAdminPackage,
  updateSetting,
} from "@/repositories/admin";
import { insertOutboxEvent } from "@/repositories/listing-publications";
import { insertSystemStatusHistory } from "@/repositories/payment-checkout";
import { maskPhone } from "@/auth/phone";

/**
 * Admin operational commands (Phase 4.15). Every mutation is a
 * dedicated audited command; server authorization (requireAdmin /
 * requireSuperAdmin at the route layer) is re-checked here where role
 * rules apply. No command ever mutates payment snapshots or audit
 * history.
 */

// --- cursors ----------------------------------------------------------------

export function encodeAdminCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString("base64url");
}

export function decodeAdminCursor(cursor: string): { createdAt: string; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const [ts, id] = decoded.split("|");
  if (
    ts === undefined ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/.test(ts) ||
    !/^[0-9a-f-]{36}$/.test(id ?? "")
  ) {
    throw new ApiError("VALIDATION_ERROR", "Invalid cursor.");
  }
  return { createdAt: ts, id: id! };
}

const PAGE = 25;

function page<T extends { created_at_cursor: string; id: string }>(
  rows: T[],
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, PAGE);
  const nextCursor =
    rows.length > PAGE
      ? encodeAdminCursor(items[items.length - 1].created_at_cursor, items[items.length - 1].id)
      : null;
  return { items, nextCursor };
}

// --- dashboard --------------------------------------------------------------

export async function adminDashboard() {
  return dashboardCounts(getSql());
}

// --- users ------------------------------------------------------------------

export interface AdminUserDto {
  id: string;
  phoneMasked: string;
  displayName: string | null;
  status: string;
  blockedReason: string | null;
  roles: string[];
  listingCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

function toUserDto(row: Awaited<ReturnType<typeof getAdminUser>> & object): AdminUserDto {
  return {
    id: row.id,
    phoneMasked: maskPhone(row.phone_e164),
    displayName: row.display_name,
    status: row.status,
    blockedReason: row.blocked_reason,
    roles: row.roles,
    listingCount: row.listing_count,
    createdAt: row.created_at.toISOString(),
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
  };
}

export async function adminUsers(input: { phone?: string; cursor?: string }) {
  const rows = await listUsers(getSql(), {
    phone: input.phone,
    cursor: input.cursor === undefined ? undefined : decodeAdminCursor(input.cursor),
    limit: PAGE + 1,
  });
  const { items, nextCursor } = page(rows);
  return { items: items.map(toUserDto), nextCursor };
}

export async function adminStaff(): Promise<AdminUserDto[]> {
  const rows = await listStaffUsers(getSql());
  return rows.map(toUserDto);
}

export async function adminUserDetail(userId: string): Promise<AdminUserDto> {
  const row = await getAdminUser(getSql(), userId);
  if (row === undefined) {
    throw new ApiError("LISTING_NOT_FOUND", "User not found.", { status: 404 });
  }
  return toUserDto(row);
}

/**
 * Block/unblock: deliberate, audited, never self-targeted. Blocked
 * users keep read access but every mutation path already refuses them
 * (requireActiveSeller). Unblock restores ACTIVE and clears the
 * reason. SUPER_ADMIN accounts can only be blocked by a SUPER_ADMIN.
 */
export async function setUserBlockedState(
  auth: AuthContext,
  userId: string,
  input: { blocked: boolean; reason: string | null },
): Promise<AdminUserDto> {
  if (userId === auth.user.id) {
    throw new ApiError("VALIDATION_ERROR", "You cannot block or unblock your own account.");
  }
  await withTransaction(async (tx) => {
    const target = await lockUser(tx, userId);
    if (target === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "User not found.", { status: 404 });
    }
    if (target.roles.includes("SUPER_ADMIN") && !auth.roles.includes("SUPER_ADMIN")) {
      throw new ApiError("STAFF_ROLE_REQUIRED", "Super admin role required.");
    }
    const alreadyBlocked = target.status === "BLOCKED";
    if (alreadyBlocked === input.blocked) {
      return; // idempotent
    }
    await setUserBlocked(tx, userId, input);
    await insertAdminAudit(tx, {
      actorUserId: auth.user.id,
      action: input.blocked ? "USER_BLOCKED" : "USER_UNBLOCKED",
      entityType: "user",
      entityId: userId,
      afterData: { status: input.blocked ? "BLOCKED" : "ACTIVE", reason: input.reason },
    });
  });
  return adminUserDetail(userId);
}

/**
 * Role management rules:
 * - MODERATOR may be granted/revoked by ADMIN or SUPER_ADMIN.
 * - ADMIN may be granted/revoked ONLY by SUPER_ADMIN.
 * - SUPER_ADMIN is NEVER grantable or revocable through the API
 *   (provisioned operationally) — so self-escalation and
 *   last-super-admin lockout are structurally impossible.
 * - Nobody may change their own roles.
 */
export async function changeUserRole(
  auth: AuthContext,
  userId: string,
  input: { role: "MODERATOR" | "ADMIN"; action: "GRANT" | "REVOKE" },
): Promise<AdminUserDto> {
  if (userId === auth.user.id) {
    throw new ApiError("VALIDATION_ERROR", "You cannot change your own roles.");
  }
  if (input.role === "ADMIN" && !auth.roles.includes("SUPER_ADMIN")) {
    throw new ApiError("STAFF_ROLE_REQUIRED", "Super admin role required.");
  }
  await withTransaction(async (tx) => {
    const target = await lockUser(tx, userId);
    if (target === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "User not found.", { status: 404 });
    }
    const changed =
      input.action === "GRANT"
        ? await grantRole(tx, { userId, roleCode: input.role, grantedBy: auth.user.id })
        : await revokeRole(tx, { userId, roleCode: input.role });
    if (changed) {
      await insertAdminAudit(tx, {
        actorUserId: auth.user.id,
        action: input.action === "GRANT" ? "ROLE_GRANTED" : "ROLE_REVOKED",
        entityType: "user",
        entityId: userId,
        afterData: { role: input.role },
      });
    }
  });
  return adminUserDetail(userId);
}

// --- listings ---------------------------------------------------------------

export async function adminListings(input: {
  status?: string;
  category?: string;
  publicId?: string;
  ownerPhone?: string;
  cursor?: string;
}) {
  const rows = await listAdminListings(getSql(), {
    ...input,
    cursor: input.cursor === undefined ? undefined : decodeAdminCursor(input.cursor),
    limit: PAGE + 1,
  });
  const { items, nextCursor } = page(rows);
  return {
    items: items.map((row) => ({
      id: row.id,
      publicId: row.public_id,
      status: row.status,
      category: row.category,
      brand: row.brand,
      model: row.model,
      priceMinor: row.price_minor === null ? null : Number(row.price_minor),
      ownerPhoneMasked: maskPhone(row.owner_phone),
      createdAt: row.created_at.toISOString(),
      currentExpiresAt: row.current_expires_at?.toISOString() ?? null,
    })),
    nextCursor,
  };
}

export async function adminListingCommerce(listingId: string) {
  const context = await adminListingContext(getSql(), listingId);
  return {
    publications: context.publications.map((p) => ({
      number: p.publication_number,
      billingType: p.billing_type,
      createdAt: p.created_at.toISOString(),
    })),
    periods: context.periods.map((p) => ({
      number: p.period_number,
      source: p.source,
      startsAt: p.starts_at.toISOString(),
      endsAt: p.ends_at.toISOString(),
    })),
    promotions: context.promotions.map((p) => ({
      type: p.type,
      status: p.status,
      startsAt: p.starts_at.toISOString(),
      endsAt: p.ends_at.toISOString(),
      durationDays: p.purchased_duration_days,
    })),
    payments: context.payments.map((p) => ({
      id: p.id,
      type: p.type,
      amountMinor: Number(p.amount_minor),
      currency: p.currency,
      status: p.status,
      createdAt: p.created_at.toISOString(),
      paidAt: p.paid_at?.toISOString() ?? null,
    })),
  };
}

/**
 * Unsuspension policy (closes the Phase 4.14 checkpoint):
 * SUSPENDED → ACTIVE only while the current publication period is
 * still valid (current_expires_at > now()). If the publication
 * expired while suspended, the listing transitions to EXPIRED and
 * follows the accepted renewal flow — restoration never extends paid
 * listing or promotion time, and nothing is refunded.
 */
export async function unsuspendListing(
  auth: AuthContext,
  listingId: string,
): Promise<{ listing: { id: string; status: string } }> {
  return withTransaction(async (tx) => {
    const listing = await lockListingForAdmin(tx, listingId);
    if (listing === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    if (listing.status !== "SUSPENDED") {
      throw new ApiError("MODERATION_INVALID_STATE", "Only suspended listings can be restored.", {
        details: { current_status: listing.status },
      });
    }
    const stillValid =
      listing.current_expires_at !== null && listing.current_expires_at.getTime() > Date.now();
    const toStatus = stillValid ? "ACTIVE" : "EXPIRED";
    await tx`update listings set status = ${toStatus}::listing_status where id = ${listingId}`;
    await insertSystemStatusHistory(tx, {
      listingId,
      fromStatus: "SUSPENDED",
      toStatus,
      reasonCode: "ADMIN_UNSUSPEND",
    });
    await insertAdminAudit(tx, {
      actorUserId: auth.user.id,
      action: "LISTING_UNSUSPENDED",
      entityType: "listing",
      entityId: listingId,
      afterData: { status: toStatus },
    });
    await insertOutboxEvent(tx, {
      eventType: "LISTING_UNSUSPENDED",
      aggregateId: listingId,
      payload: { listing_id: listingId, status: toStatus },
    });
    return { listing: { id: listingId, status: toStatus } };
  });
}

// --- payments ---------------------------------------------------------------

export async function adminPayments(input: { status?: string; type?: string; cursor?: string }) {
  const rows = await listAdminPayments(getSql(), {
    ...input,
    cursor: input.cursor === undefined ? undefined : decodeAdminCursor(input.cursor),
    limit: PAGE + 1,
  });
  const { items, nextCursor } = page(rows);
  return {
    items: items.map((row) => ({
      id: row.id,
      type: row.type,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      status: row.status,
      fulfillmentStatus: row.fulfillment_status,
      provider: row.provider,
      providerLastStatus: row.provider_last_status,
      ownerPhoneMasked: maskPhone(row.owner_phone),
      listingPublicId: row.listing_public_id,
      createdAt: row.created_at.toISOString(),
      paidAt: row.paid_at?.toISOString() ?? null,
    })),
    nextCursor,
  };
}

export async function adminPaymentAttemptHistory(paymentId: string) {
  const rows = await adminPaymentAttempts(getSql(), paymentId);
  return rows.map((row) => ({
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    providerStatus: row.provider_status,
    isTerminal: row.is_terminal,
    succeeded: row.succeeded,
    createdAt: row.created_at.toISOString(),
  }));
}

// --- promotion packages -----------------------------------------------------

export async function adminPackages() {
  const rows = await listAdminPackages(getSql());
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    durationDays: row.duration_days,
    priceMinor: Number(row.price_minor),
    currency: row.currency,
    isActive: row.is_active,
    version: row.updated_at_cursor,
  }));
}

/**
 * Package pricing/activation. Optimistic concurrency: the caller's
 * version (trigger-maintained updated_at) must still match, so two
 * admins can never silently overwrite each other. Snapshots on
 * existing payment intents are untouched by design — prices apply to
 * FUTURE intents only. Activation requires a positive approved price.
 */
export async function updatePromotionPackage(
  auth: AuthContext,
  packageId: string,
  input: { version: string; priceMinor?: number; isActive?: boolean },
) {
  if (input.isActive === true) {
    const current = (await listAdminPackages(getSql())).find((p) => p.id === packageId);
    const priceAfter = input.priceMinor ?? (current ? Number(current.price_minor) : 0);
    if (priceAfter <= 0) {
      throw new ApiError("VALIDATION_ERROR", "Activation requires an approved positive price.");
    }
  }
  return withTransaction(async (tx) => {
    const updated = await updateAdminPackage(tx, {
      packageId,
      expectedUpdatedAt: input.version,
      priceMinor: input.priceMinor,
      isActive: input.isActive,
    });
    if (updated === null) {
      throw new ApiError("LISTING_REVISION_CONFLICT", "The package changed during editing.", {
        status: 409,
      });
    }
    await insertAdminAudit(tx, {
      actorUserId: auth.user.id,
      action: "PROMOTION_PACKAGE_UPDATED",
      entityType: "promotion_package",
      entityId: packageId,
      afterData: {
        price_minor: Number(updated.price_minor),
        is_active: updated.is_active,
      },
    });
    return {
      id: updated.id,
      type: updated.type,
      name: updated.name,
      durationDays: updated.duration_days,
      priceMinor: Number(updated.price_minor),
      currency: updated.currency,
      isActive: updated.is_active,
      version: updated.updated_at_cursor,
    };
  });
}

// --- settings ---------------------------------------------------------------

/** Runtime-administrable settings — a typed allowlist, never a generic editor. */
export const ADMIN_SETTING_KEYS = [
  "listing.validity_days",
  "listing.free_publication_limit",
  "listing.publication_fee_minor",
  "listing.renewal_fee_minor",
  "listing.renewal_duration_days",
  "listing.image_min",
  "listing.image_max",
  "boost.first_view_slots_desktop",
  "boost.first_view_slots_tablet",
  "boost.first_view_slots_mobile",
] as const;

const SETTING_BOUNDS: Record<string, { min: number; max: number }> = {
  "listing.validity_days": { min: 1, max: 365 },
  "listing.free_publication_limit": { min: 0, max: 100 },
  "listing.publication_fee_minor": { min: 1, max: 100_000_000 },
  "listing.renewal_fee_minor": { min: 1, max: 100_000_000 },
  "listing.renewal_duration_days": { min: 1, max: 365 },
  "listing.image_min": { min: 1, max: 20 },
  "listing.image_max": { min: 1, max: 50 },
  "boost.first_view_slots_desktop": { min: 0, max: 12 },
  "boost.first_view_slots_tablet": { min: 0, max: 12 },
  "boost.first_view_slots_mobile": { min: 0, max: 12 },
};

export async function adminSettings() {
  const rows = await listSettings(getSql(), [...ADMIN_SETTING_KEYS]);
  return rows.map((row) => ({
    key: row.key,
    value: Number(row.value),
    valueType: row.value_type,
    description: row.description,
    version: row.updated_at_cursor,
  }));
}

export async function updateAdminSetting(
  auth: AuthContext,
  input: { key: string; value: number; version: string },
) {
  if (!(ADMIN_SETTING_KEYS as readonly string[]).includes(input.key)) {
    throw new ApiError("VALIDATION_ERROR", "This setting is not administrable.");
  }
  const bounds = SETTING_BOUNDS[input.key];
  if (!Number.isSafeInteger(input.value) || input.value < bounds.min || input.value > bounds.max) {
    throw new ApiError("VALIDATION_ERROR", "Value is outside the allowed range.");
  }
  return withTransaction(async (tx) => {
    const updated = await updateSetting(tx, {
      key: input.key,
      value: input.value,
      expectedUpdatedAt: input.version,
      updatedBy: auth.user.id,
    });
    if (updated === null) {
      throw new ApiError("LISTING_REVISION_CONFLICT", "The setting changed during editing.", {
        status: 409,
      });
    }
    await insertAdminAudit(tx, {
      actorUserId: auth.user.id,
      action: "SETTING_UPDATED",
      entityType: "system_setting",
      entityId: input.key,
      afterData: { value: input.value },
    });
    return {
      key: updated.key,
      value: Number(updated.value),
      valueType: updated.value_type,
      description: updated.description,
      version: updated.updated_at_cursor,
    };
  });
}

// --- catalog ----------------------------------------------------------------

export const ADMIN_CATALOG_ENTITIES = ["brands", "models", "cities", "features", "options"] as const;

export async function adminCatalog(entity: string) {
  if (!(ADMIN_CATALOG_ENTITIES as readonly string[]).includes(entity)) {
    throw new ApiError("VALIDATION_ERROR", "Unknown catalog entity.");
  }
  return listAdminCatalog(getSql(), entity);
}

/** Activation toggle only — history-referenced rows are never deleted. */
export async function setAdminCatalogActive(
  auth: AuthContext,
  entity: string,
  id: string,
  isActive: boolean,
) {
  if (!(ADMIN_CATALOG_ENTITIES as readonly string[]).includes(entity)) {
    throw new ApiError("VALIDATION_ERROR", "Unknown catalog entity.");
  }
  return withTransaction(async (tx) => {
    const changed = await setCatalogActive(tx, entity, id, isActive);
    if (!changed) {
      throw new ApiError("LISTING_NOT_FOUND", "Catalog item not found.");
    }
    await insertAdminAudit(tx, {
      actorUserId: auth.user.id,
      action: isActive ? "CATALOG_ACTIVATED" : "CATALOG_DEACTIVATED",
      entityType: `catalog_${entity}`,
      entityId: id,
      afterData: { is_active: isActive },
    });
    return { id, isActive };
  });
}

// --- reports ----------------------------------------------------------------

export async function adminReports(input: { status?: string; cursor?: string }) {
  const rows = await listReports(getSql(), {
    status: input.status,
    cursor: input.cursor === undefined ? undefined : decodeAdminCursor(input.cursor),
    limit: PAGE + 1,
  });
  const { items, nextCursor } = page(rows);
  return {
    items: items.map((row) => ({
      id: row.id,
      listingId: row.listing_id,
      listingPublicId: row.listing_public_id,
      reasonCode: row.reason_code,
      note: row.note,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
    })),
    nextCursor,
  };
}

export async function resolveAdminReport(
  auth: AuthContext,
  reportId: string,
  status: "RESOLVED" | "DISMISSED",
) {
  return withTransaction(async (tx) => {
    const changed = await resolveReport(tx, { reportId, status, resolvedBy: auth.user.id });
    if (!changed) {
      throw new ApiError("MODERATION_INVALID_STATE", "The report is not open.");
    }
    await insertAdminAudit(tx, {
      actorUserId: auth.user.id,
      action: `REPORT_${status}`,
      entityType: "listing_report",
      entityId: reportId,
      afterData: { status },
    });
    return { id: reportId, status };
  });
}

// --- audit ------------------------------------------------------------------

export async function adminAudit(input: {
  action?: string;
  entityId?: string;
  actorType?: string;
  cursor?: string;
}) {
  const rows = await listAudit(getSql(), {
    ...input,
    cursor: input.cursor === undefined ? undefined : decodeAdminCursor(input.cursor),
    limit: PAGE + 1,
  });
  const { items, nextCursor } = page(rows);
  return {
    items: items.map((row) => ({
      id: row.id,
      actorType: row.actor_type,
      actorPhoneMasked: row.actor_phone === null ? null : maskPhone(row.actor_phone),
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      afterData: row.after_data,
      createdAt: row.created_at.toISOString(),
    })),
    nextCursor,
  };
}
