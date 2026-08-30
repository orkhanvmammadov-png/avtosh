import type { Sql } from "@/lib/server/db/client";

/**
 * Admin operational persistence (Phase 4.15). Read models are safe
 * projections (no tokens, OTP material, provider secrets, or raw
 * payloads); every list paginates via keyset cursors; mutations are
 * dedicated commands, never arbitrary status writes.
 */

// --- dashboard --------------------------------------------------------------

export interface DashboardCounts {
  users: number;
  active_listings: number;
  pending_moderation: number;
  payment_required: number;
  pending_payments: number;
  open_reports: number;
}

export async function dashboardCounts(sql: Sql): Promise<DashboardCounts> {
  const [row] = await sql<Record<string, string>[]>`
    select
      (select count(*)::text from users) as users,
      (select count(*)::text from listings where status = 'ACTIVE' and current_expires_at > now()) as active_listings,
      (select count(*)::text from listings where status = 'PENDING_MODERATION') as pending_moderation,
      (select count(*)::text from listings where status = 'PAYMENT_REQUIRED') as payment_required,
      (select count(*)::text from payments where status = 'PENDING') as pending_payments,
      (select count(*)::text from listing_reports where status = 'OPEN') as open_reports
  `;
  return {
    users: Number(row.users),
    active_listings: Number(row.active_listings),
    pending_moderation: Number(row.pending_moderation),
    payment_required: Number(row.payment_required),
    pending_payments: Number(row.pending_payments),
    open_reports: Number(row.open_reports),
  };
}

// --- users ------------------------------------------------------------------

export interface AdminUserRow {
  id: string;
  phone_e164: string;
  display_name: string | null;
  status: string;
  blocked_reason: string | null;
  created_at: Date;
  created_at_cursor: string;
  last_login_at: Date | null;
  roles: string[];
  listing_count: number;
}

export async function listUsers(
  sql: Sql,
  input: { phone?: string; cursor?: { createdAt: string; id: string }; limit: number },
): Promise<AdminUserRow[]> {
  return sql<AdminUserRow[]>`
    select u.id, u.phone_e164, u.display_name, u.status::text as status,
           u.blocked_reason, u.created_at, u.created_at::text as created_at_cursor, u.last_login_at,
           coalesce((select array_agg(r.code order by r.code) from user_roles ur
             join roles r on r.id = ur.role_id where ur.user_id = u.id), '{}') as roles,
           (select count(*)::int from listings l where l.owner_id = u.id and l.status <> 'DELETED') as listing_count
    from users u
    where true
      ${input.phone === undefined ? sql`` : sql`and u.phone_e164 like ${`%${input.phone}%`}`}
      ${input.cursor === undefined ? sql`` : sql`and (u.created_at, u.id) < (${input.cursor.createdAt}::text::timestamptz, ${input.cursor.id}::uuid)`}
    order by u.created_at desc, u.id desc
    limit ${input.limit}
  `;
}

export async function getAdminUser(sql: Sql, userId: string): Promise<AdminUserRow | undefined> {
  const rows = await sql<AdminUserRow[]>`
    select u.id, u.phone_e164, u.display_name, u.status::text as status,
           u.blocked_reason, u.created_at, u.created_at::text as created_at_cursor, u.last_login_at,
           coalesce((select array_agg(r.code order by r.code) from user_roles ur
             join roles r on r.id = ur.role_id where ur.user_id = u.id), '{}') as roles,
           (select count(*)::int from listings l where l.owner_id = u.id and l.status <> 'DELETED') as listing_count
    from users u where u.id = ${userId}
  `;
  return rows[0];
}

export async function lockUser(
  sql: Sql,
  userId: string,
): Promise<{ id: string; status: string; roles: string[] } | undefined> {
  const rows = await sql<{ id: string; status: string; roles: string[] }[]>`
    select u.id, u.status::text as status,
           coalesce((select array_agg(r.code) from user_roles ur
             join roles r on r.id = ur.role_id where ur.user_id = u.id), '{}') as roles
    from users u where u.id = ${userId}
    for update of u
  `;
  return rows[0];
}

export async function setUserBlocked(
  sql: Sql,
  userId: string,
  input: { blocked: boolean; reason: string | null },
): Promise<void> {
  if (input.blocked) {
    await sql`
      update users set status = 'BLOCKED', blocked_at = now(), blocked_reason = ${input.reason}
      where id = ${userId}
    `;
  } else {
    await sql`
      update users set status = 'ACTIVE', blocked_at = null, blocked_reason = null
      where id = ${userId}
    `;
  }
}

export async function grantRole(
  sql: Sql,
  input: { userId: string; roleCode: string; grantedBy: string },
): Promise<boolean> {
  const rows = await sql<{ user_id: string }[]>`
    insert into user_roles (user_id, role_id, granted_by)
    select ${input.userId}, id, ${input.grantedBy} from roles where code = ${input.roleCode}
    on conflict do nothing
    returning user_id
  `;
  return rows.length > 0;
}

export async function revokeRole(
  sql: Sql,
  input: { userId: string; roleCode: string },
): Promise<boolean> {
  const rows = await sql<{ user_id: string }[]>`
    delete from user_roles ur
    using roles r
    where r.id = ur.role_id and ur.user_id = ${input.userId} and r.code = ${input.roleCode}
    returning ur.user_id
  `;
  return rows.length > 0;
}

/** Users holding any staff role (staff management page). */
export async function listStaffUsers(sql: Sql): Promise<AdminUserRow[]> {
  return sql<AdminUserRow[]>`
    select u.id, u.phone_e164, u.display_name, u.status::text as status,
           u.blocked_reason, u.created_at, u.created_at::text as created_at_cursor, u.last_login_at,
           coalesce((select array_agg(r.code order by r.code) from user_roles ur
             join roles r on r.id = ur.role_id where ur.user_id = u.id), '{}') as roles,
           (select count(*)::int from listings l where l.owner_id = u.id and l.status <> 'DELETED') as listing_count
    from users u
    where exists (
      select 1 from user_roles ur join roles r on r.id = ur.role_id
      where ur.user_id = u.id and r.code in ('MODERATOR', 'ADMIN', 'SUPER_ADMIN')
    )
    order by u.created_at asc
    limit 200
  `;
}

// --- listings ---------------------------------------------------------------

export interface AdminListingRow {
  id: string;
  public_id: string;
  status: string;
  category: string;
  brand: string | null;
  model: string | null;
  price_minor: string | null;
  owner_phone: string;
  created_at: Date;
  created_at_cursor: string;
  current_expires_at: Date | null;
}

export async function listAdminListings(
  sql: Sql,
  input: {
    status?: string;
    category?: string;
    publicId?: string;
    ownerPhone?: string;
    cursor?: { createdAt: string; id: string };
    limit: number;
  },
): Promise<AdminListingRow[]> {
  return sql<AdminListingRow[]>`
    select l.id, l.public_id::text as public_id, l.status::text as status,
           c.code as category, b.name as brand, m.name as model,
           l.price_minor::text as price_minor, u.phone_e164 as owner_phone,
           l.created_at, l.created_at::text as created_at_cursor, l.current_expires_at
    from listings l
    join categories c on c.id = l.category_id
    join users u on u.id = l.owner_id
    left join brands b on b.id = l.brand_id
    left join models m on m.id = l.model_id
    where true
      ${input.status === undefined ? sql`` : sql`and l.status = ${input.status}::listing_status`}
      ${input.category === undefined ? sql`` : sql`and c.code = ${input.category}`}
      ${input.publicId === undefined ? sql`` : sql`and l.public_id = ${input.publicId}::bigint`}
      ${input.ownerPhone === undefined ? sql`` : sql`and u.phone_e164 like ${`%${input.ownerPhone}%`}`}
      ${input.cursor === undefined ? sql`` : sql`and (l.created_at, l.id) < (${input.cursor.createdAt}::text::timestamptz, ${input.cursor.id}::uuid)`}
    order by l.created_at desc, l.id desc
    limit ${input.limit}
  `;
}

/** Commerce/lifecycle context for the admin listing detail. */
export async function adminListingContext(sql: Sql, listingId: string) {
  const [publications, periods, promotions, payments] = await Promise.all([
    sql<{ publication_number: number; billing_type: string; created_at: Date }[]>`
      select publication_number, billing_type::text as billing_type, created_at
      from listing_publications where listing_id = ${listingId}
    `,
    sql<{ period_number: number; source: string; starts_at: Date; ends_at: Date }[]>`
      select period_number, source::text as source, starts_at, ends_at
      from listing_periods where listing_id = ${listingId} order by period_number
    `,
    sql<{ type: string; status: string; starts_at: Date; ends_at: Date; purchased_duration_days: number }[]>`
      select type::text as type, status::text as status, starts_at, ends_at, purchased_duration_days
      from listing_promotions where listing_id = ${listingId} order by starts_at desc
    `,
    sql<{ id: string; type: string; amount_minor: string; currency: string; status: string; created_at: Date; paid_at: Date | null }[]>`
      select id, type::text as type, amount_minor::text as amount_minor, currency,
             status::text as status, created_at, paid_at
      from payments where listing_id = ${listingId} order by created_at desc
    `,
  ]);
  return { publications, periods, promotions, payments };
}

export async function lockListingForAdmin(
  sql: Sql,
  listingId: string,
): Promise<{ id: string; status: string; revision: number; current_expires_at: Date | null } | undefined> {
  const rows = await sql<
    { id: string; status: string; revision: number; current_expires_at: Date | null }[]
  >`
    select id, status::text as status, revision, current_expires_at
    from listings where id = ${listingId} for update
  `;
  return rows[0];
}

// --- payments ---------------------------------------------------------------

export interface AdminPaymentRow {
  id: string;
  type: string;
  amount_minor: string;
  currency: string;
  status: string;
  fulfillment_status: string;
  provider: string | null;
  provider_last_status: string | null;
  owner_phone: string;
  listing_public_id: string | null;
  created_at: Date;
  created_at_cursor: string;
  paid_at: Date | null;
}

export async function listAdminPayments(
  sql: Sql,
  input: {
    status?: string;
    type?: string;
    cursor?: { createdAt: string; id: string };
    limit: number;
  },
): Promise<AdminPaymentRow[]> {
  return sql<AdminPaymentRow[]>`
    select p.id, p.type::text as type, p.amount_minor::text as amount_minor, p.currency,
           p.status::text as status, p.fulfillment_status::text as fulfillment_status,
           p.provider,
           (select a.provider_status from payment_provider_attempts a
             where a.payment_id = p.id order by a.created_at desc limit 1) as provider_last_status,
           u.phone_e164 as owner_phone, l.public_id::text as listing_public_id,
           p.created_at, p.created_at::text as created_at_cursor, p.paid_at
    from payments p
    join users u on u.id = p.user_id
    left join listings l on l.id = p.listing_id
    where true
      ${input.status === undefined ? sql`` : sql`and p.status = ${input.status}::payment_status`}
      ${input.type === undefined ? sql`` : sql`and p.type = ${input.type}::payment_type`}
      ${input.cursor === undefined ? sql`` : sql`and (p.created_at, p.id) < (${input.cursor.createdAt}::text::timestamptz, ${input.cursor.id}::uuid)`}
    order by p.created_at desc, p.id desc
    limit ${input.limit}
  `;
}

/** Safe attempt history: never the hpp secret. */
export async function adminPaymentAttempts(sql: Sql, paymentId: string) {
  return sql<{ provider: string; provider_order_id: string | null; provider_status: string; is_terminal: boolean; succeeded: boolean; created_at: Date }[]>`
    select provider, provider_order_id, provider_status, is_terminal, succeeded, created_at
    from payment_provider_attempts where payment_id = ${paymentId}
    order by created_at desc
  `;
}

// --- promotion packages -----------------------------------------------------

export interface AdminPackageRow {
  id: string;
  type: string;
  name: string;
  duration_days: number;
  price_minor: string;
  currency: string;
  is_active: boolean;
  updated_at_cursor: string;
}

export async function listAdminPackages(sql: Sql): Promise<AdminPackageRow[]> {
  return sql<AdminPackageRow[]>`
    select id, type::text as type, name, duration_days, price_minor::text as price_minor,
           currency, is_active, updated_at::text as updated_at_cursor
    from promotion_packages
    order by type, sort_order, duration_days
  `;
}

/**
 * Optimistic concurrency without a migration: the trigger-maintained
 * updated_at is the version token (full-precision text round trip).
 * A concurrent edit changes updated_at and the stale write matches
 * zero rows.
 */
export async function updateAdminPackage(
  sql: Sql,
  input: {
    packageId: string;
    expectedUpdatedAt: string;
    priceMinor?: number;
    isActive?: boolean;
  },
): Promise<AdminPackageRow | null> {
  const rows = await sql<AdminPackageRow[]>`
    update promotion_packages set
      price_minor = coalesce(${input.priceMinor ?? null}::bigint, price_minor),
      is_active = coalesce(${input.isActive ?? null}::boolean, is_active)
    where id = ${input.packageId}
      and updated_at = ${input.expectedUpdatedAt}::text::timestamptz
    returning id, type::text as type, name, duration_days, price_minor::text as price_minor,
              currency, is_active, updated_at::text as updated_at_cursor
  `;
  return rows[0] ?? null;
}

// --- system settings --------------------------------------------------------

export interface AdminSettingRow {
  key: string;
  value: unknown;
  value_type: string;
  description: string | null;
  updated_at_cursor: string;
}

export async function listSettings(sql: Sql, keys: string[]): Promise<AdminSettingRow[]> {
  return sql<AdminSettingRow[]>`
    select key, value, value_type, description, updated_at::text as updated_at_cursor
    from system_settings where key in ${sql(keys)}
    order by key
  `;
}

export async function updateSetting(
  sql: Sql,
  input: { key: string; value: number; expectedUpdatedAt: string; updatedBy: string },
): Promise<AdminSettingRow | null> {
  const rows = await sql<AdminSettingRow[]>`
    update system_settings
    set value = to_jsonb(${input.value}::bigint), updated_by = ${input.updatedBy}, updated_at = now()
    where key = ${input.key}
      and updated_at = ${input.expectedUpdatedAt}::text::timestamptz
    returning key, value, value_type, description, updated_at::text as updated_at_cursor
  `;
  return rows[0] ?? null;
}

// --- catalog ----------------------------------------------------------------

export interface AdminCatalogRow {
  id: string;
  name: string;
  extra: string | null;
  is_active: boolean;
}

export async function listAdminCatalog(sql: Sql, entity: string): Promise<AdminCatalogRow[]> {
  switch (entity) {
    case "brands":
      return sql<AdminCatalogRow[]>`
        select id, name, null as extra, is_active from brands order by name`;
    case "models":
      return sql<AdminCatalogRow[]>`
        select m.id, m.name, b.name as extra, m.is_active
        from models m join brands b on b.id = m.brand_id order by b.name, m.name`;
    case "cities":
      return sql<AdminCatalogRow[]>`
        select id, name_az as name, null as extra, is_active from cities order by sort_order, name_az`;
    case "features":
      return sql<AdminCatalogRow[]>`
        select id, name_az as name, code as extra, is_active from features order by name_az`;
    case "options":
      return sql<AdminCatalogRow[]>`
        select id, name_az as name, group_code as extra, is_active
        from reference_options order by group_code, sort_order`;
    default:
      return [];
  }
}

/** Activation toggle only — catalog rows are never deleted (history). */
export async function setCatalogActive(
  sql: Sql,
  entity: string,
  id: string,
  isActive: boolean,
): Promise<boolean> {
  let rows: { id: string }[] = [];
  switch (entity) {
    case "brands":
      rows = await sql<{ id: string }[]>`
        update brands set is_active = ${isActive} where id = ${id} returning id`;
      break;
    case "models":
      rows = await sql<{ id: string }[]>`
        update models set is_active = ${isActive} where id = ${id} returning id`;
      break;
    case "cities":
      rows = await sql<{ id: string }[]>`
        update cities set is_active = ${isActive} where id = ${id} returning id`;
      break;
    case "features":
      rows = await sql<{ id: string }[]>`
        update features set is_active = ${isActive} where id = ${id} returning id`;
      break;
    case "options":
      rows = await sql<{ id: string }[]>`
        update reference_options set is_active = ${isActive} where id = ${id} returning id`;
      break;
  }
  return rows.length > 0;
}

// --- reports ----------------------------------------------------------------

export interface AdminReportRow {
  id: string;
  listing_id: string;
  listing_public_id: string | null;
  reason_code: string;
  note: string | null;
  status: string;
  created_at: Date;
  created_at_cursor: string;
  resolved_at: Date | null;
}

export async function listReports(
  sql: Sql,
  input: { status?: string; cursor?: { createdAt: string; id: string }; limit: number },
): Promise<AdminReportRow[]> {
  return sql<AdminReportRow[]>`
    select r.id, r.listing_id, l.public_id::text as listing_public_id,
           r.reason_code, r.note, r.status::text as status, r.created_at, r.created_at::text as created_at_cursor, r.resolved_at
    from listing_reports r
    left join listings l on l.id = r.listing_id
    where true
      ${input.status === undefined ? sql`` : sql`and r.status = ${input.status}::report_status`}
      ${input.cursor === undefined ? sql`` : sql`and (r.created_at, r.id) < (${input.cursor.createdAt}::text::timestamptz, ${input.cursor.id}::uuid)`}
    order by r.created_at desc, r.id desc
    limit ${input.limit}
  `;
}

export async function resolveReport(
  sql: Sql,
  input: { reportId: string; status: "RESOLVED" | "DISMISSED"; resolvedBy: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update listing_reports
    set status = ${input.status}::report_status, resolved_by = ${input.resolvedBy}, resolved_at = now()
    where id = ${input.reportId} and status = 'OPEN'
    returning id
  `;
  return rows.length > 0;
}

// --- audit ------------------------------------------------------------------

export interface AdminAuditRow {
  id: string;
  actor_type: string;
  actor_phone: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  after_data: unknown;
  created_at: Date;
  created_at_cursor: string;
}

export async function listAudit(
  sql: Sql,
  input: {
    action?: string;
    entityId?: string;
    actorType?: string;
    cursor?: { createdAt: string; id: string };
    limit: number;
  },
): Promise<AdminAuditRow[]> {
  return sql<AdminAuditRow[]>`
    select a.id, a.actor_type::text as actor_type, u.phone_e164 as actor_phone,
           a.action, a.entity_type, a.entity_id, a.after_data, a.created_at, a.created_at::text as created_at_cursor
    from audit_logs a
    left join users u on u.id = a.actor_user_id
    where true
      ${input.action === undefined ? sql`` : sql`and a.action = ${input.action}`}
      ${input.entityId === undefined ? sql`` : sql`and a.entity_id = ${input.entityId}`}
      ${input.actorType === undefined ? sql`` : sql`and a.actor_type = ${input.actorType}::actor_type`}
      ${input.cursor === undefined ? sql`` : sql`and (a.created_at, a.id) < (${input.cursor.createdAt}::text::timestamptz, ${input.cursor.id}::uuid)`}
    order by a.created_at desc, a.id desc
    limit ${input.limit}
  `;
}

/** Append-only audit entry for admin mutations (never secrets). */
export async function insertAdminAudit(
  sql: Sql,
  input: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    afterData: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await sql`
    insert into audit_logs (actor_user_id, actor_type, action, entity_type, entity_id, after_data)
    values (${input.actorUserId}, 'ADMIN', ${input.action}, ${input.entityType},
      ${input.entityId}, ${sql.json(input.afterData)})
  `;
}
