import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { publicDetail } from "@/services/marketplace";
import { createTestUserSession } from "./helpers/session";
import { api } from "./helpers/listing";
import { GET as dashboardRoute } from "@/app/api/v1/admin/dashboard/route";
import { GET as usersRoute } from "@/app/api/v1/admin/users/route";
import { GET as userDetailRoute } from "@/app/api/v1/admin/users/[userId]/route";
import { POST as blockRoute } from "@/app/api/v1/admin/users/[userId]/block/route";
import { POST as unblockRoute } from "@/app/api/v1/admin/users/[userId]/unblock/route";
import { POST as rolesRoute } from "@/app/api/v1/admin/users/[userId]/roles/route";
import { GET as listingsRoute } from "@/app/api/v1/admin/listings/route";
import { POST as unsuspendRoute } from "@/app/api/v1/admin/listings/[listingId]/unsuspend/route";
import { GET as reportsRoute } from "@/app/api/v1/admin/reports/route";
import { POST as resolveReportRoute } from "@/app/api/v1/admin/reports/[reportId]/resolve/route";
import { GET as auditRoute } from "@/app/api/v1/admin/audit/route";
import { GET as catalogRoute, POST as catalogToggleRoute } from "@/app/api/v1/admin/catalog/[entity]/route";
import { GET as moderatorQueueRoute } from "@/app/api/v1/moderator/listings/route";
import { POST as createDraftRoute } from "@/app/api/v1/me/listings/route";

/**
 * Phase 4.15 admin panel: RBAC matrix, user administration
 * (block/unblock, role rules incl. the SUPER_ADMIN boundary),
 * listings ops + the unsuspension policy, reports workflow, catalog
 * toggles, and the read-only audit explorer.
 */

const BASE = "http://localhost/api/v1/admin";

let superAdmin: { userId: string; cookie: string };
let admin: { userId: string; cookie: string };
let secondAdmin: { userId: string; cookie: string };
let moderator: { userId: string; cookie: string };
let plainUser: { userId: string; cookie: string };
let blockedAdmin: { userId: string; cookie: string };
let seller: { userId: string; cookie: string };
let carCat = "";

async function insertListing(
  ownerId: string,
  options: { status?: string; expiresOffsetDays?: number } = {},
): Promise<{ id: string; publicId: string }> {
  const sql = getSql();
  const status = options.status ?? "ACTIVE";
  const published = ["ACTIVE", "SOLD", "EXPIRED", "SUSPENDED"].includes(status);
  const [row] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, status, published_at, current_expires_at)
    values (${ownerId}, ${carCat}, ${status}::listing_status,
      ${published ? sql`now() - interval '1 day'` : null},
      ${published ? sql`now() + (${options.expiresOffsetDays ?? 20} || ' days')::interval` : null})
    returning id, public_id::text as public_id
  `;
  return { id: row.id, publicId: row.public_id };
}

async function auditCount(action: string, entityId: string): Promise<number> {
  const sql = getSql();
  const [row] = await sql<{ n: string }[]>`
    select count(*)::text as n from audit_logs
    where action = ${action} and entity_id = ${entityId}
  `;
  return Number(row.n);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  const sql = getSql();
  superAdmin = await createTestUserSession("+994523000001", { roles: ["SUPER_ADMIN"] });
  admin = await createTestUserSession("+994523000002", { roles: ["ADMIN"] });
  secondAdmin = await createTestUserSession("+994523000003", { roles: ["ADMIN"] });
  moderator = await createTestUserSession("+994523000004", { roles: ["MODERATOR"] });
  plainUser = await createTestUserSession("+994523000005");
  blockedAdmin = await createTestUserSession("+994523000006", { roles: ["ADMIN"], blocked: true });
  seller = await createTestUserSession("+994523000007");
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
});

afterAll(async () => {
  await closeSql();
});

describe("admin RBAC matrix", () => {
  const readRoutes: [string, typeof dashboardRoute, string][] = [
    ["dashboard", dashboardRoute, `${BASE}/dashboard`],
    ["users", usersRoute, `${BASE}/users`],
    ["listings", listingsRoute, `${BASE}/listings`],
    ["audit", auditRoute, `${BASE}/audit`],
  ];

  it("denies anonymous (401), USER, MODERATOR (403) and blocked admins on every route", async () => {
    for (const [, route, url] of readRoutes) {
      expect((await api(route, "GET", url)).status).toBe(401);
      const asUser = await api(route, "GET", url, { cookie: plainUser.cookie });
      expect(asUser.status).toBe(403);
      expect(asUser.body.error?.code).toBe("STAFF_ROLE_REQUIRED");
      const asModerator = await api(route, "GET", url, { cookie: moderator.cookie });
      expect(asModerator.status).toBe(403);
      expect(asModerator.body.error?.code).toBe("STAFF_ROLE_REQUIRED");
      const asBlocked = await api(route, "GET", url, { cookie: blockedAdmin.cookie });
      expect(asBlocked.status).toBe(403);
      expect(asBlocked.body.error?.code).toBe("USER_BLOCKED");
    }
    // a mutation route follows the same matrix
    const target = await insertListing(seller.userId, { status: "SUSPENDED" });
    const unsuspendUrl = `${BASE}/listings/${target.id}/unsuspend`;
    const call = (cookie?: string) =>
      api(unsuspendRoute, "POST", unsuspendUrl, { cookie, params: { listingId: target.id }, body: {} });
    expect((await call()).status).toBe(401);
    expect((await call(plainUser.cookie)).status).toBe(403);
    expect((await call(moderator.cookie)).status).toBe(403);
    expect((await call(blockedAdmin.cookie)).status).toBe(403);
  });

  it("allows ADMIN and SUPER_ADMIN", async () => {
    for (const [, route, url] of readRoutes) {
      expect((await api(route, "GET", url, { cookie: admin.cookie })).status).toBe(200);
      expect((await api(route, "GET", url, { cookie: superAdmin.cookie })).status).toBe(200);
    }
  });

  it("rejects cross-origin admin mutations (CSRF defense in depth)", async () => {
    const r = await api(blockRoute, "POST", `${BASE}/users/${seller.userId}/block`, {
      cookie: admin.cookie,
      params: { userId: seller.userId },
      body: {},
      origin: "https://evil.example",
    });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("dashboard returns operational counts only", async () => {
    const r = await api(dashboardRoute, "GET", `${BASE}/dashboard`, { cookie: admin.cookie });
    const counts = r.body.data as Record<string, number>;
    for (const key of ["users", "active_listings", "pending_moderation", "payment_required", "pending_payments", "open_reports"]) {
      expect(typeof counts[key]).toBe("number");
    }
  });
});

describe("admin users — search, pagination, masking", () => {
  it("searches by phone fragment, masks phones, and paginates with a keyset cursor", async () => {
    for (let i = 0; i < 27; i += 1) {
      await createTestUserSession(`+9945231000${String(i).padStart(2, "0")}`);
    }
    const first = await api(usersRoute, "GET", `${BASE}/users?phone=%2B9945231000`, {
      cookie: admin.cookie,
    });
    expect(first.status).toBe(200);
    const page1 = first.body.data as { items: { id: string; phoneMasked: string }[]; nextCursor: string | null };
    expect(page1.items).toHaveLength(25);
    expect(page1.nextCursor).not.toBeNull();
    for (const row of page1.items) {
      expect(row.phoneMasked).not.toMatch(/^\+9945231000\d{2}$/); // full phone never serialized
      expect(JSON.stringify(row)).not.toContain("+9945231000");
    }
    const second = await api(
      usersRoute,
      "GET",
      `${BASE}/users?phone=%2B9945231000&cursor=${page1.nextCursor}`,
      { cookie: admin.cookie },
    );
    const page2 = second.body.data as { items: { id: string }[]; nextCursor: string | null };
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const ids = new Set([...page1.items, ...page2.items].map((row) => row.id));
    expect(ids.size).toBe(27); // no duplicates or gaps across pages

    const detail = await api(userDetailRoute, "GET", `${BASE}/users/${page1.items[0].id}`, {
      cookie: admin.cookie,
      params: { userId: page1.items[0].id },
    });
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain("+9945231000"); // detail masks too
  });

  it("rejects malformed cursors and phone filters instead of composing queries from them", async () => {
    const badCursor = await api(usersRoute, "GET", `${BASE}/users?cursor=${Buffer.from("junk|junk").toString("base64url")}`, {
      cookie: admin.cookie,
    });
    expect(badCursor.status).toBe(400);
    const badPhone = await api(usersRoute, "GET", `${BASE}/users?phone=${encodeURIComponent("' or 1=1 --")}`, {
      cookie: admin.cookie,
    });
    expect(badPhone.status).toBe(400);
  });
});

describe("admin users — block / unblock", () => {
  it("blocks a seller (audited), refuses their mutations while blocked, and restores them on unblock", async () => {
    const target = await createTestUserSession("+994523000010");
    const draftUrl = "http://localhost/api/v1/me/listings";
    const draft = () =>
      api(createDraftRoute, "POST", draftUrl, { cookie: target.cookie, body: { category: "CAR" } });
    expect((await draft()).status).toBe(201);

    const blocked = await api(blockRoute, "POST", `${BASE}/users/${target.userId}/block`, {
      cookie: admin.cookie,
      params: { userId: target.userId },
      body: { reason: "Qayda pozuntusu" },
    });
    expect(blocked.status).toBe(200);
    expect((blocked.body.data?.user as { status: string }).status).toBe("BLOCKED");
    expect(await auditCount("USER_BLOCKED", target.userId)).toBe(1);

    const refused = await draft();
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe("USER_BLOCKED");

    // idempotent retry: no state churn, no duplicate audit
    const again = await api(blockRoute, "POST", `${BASE}/users/${target.userId}/block`, {
      cookie: admin.cookie,
      params: { userId: target.userId },
      body: {},
    });
    expect(again.status).toBe(200);
    expect(await auditCount("USER_BLOCKED", target.userId)).toBe(1);

    const unblocked = await api(unblockRoute, "POST", `${BASE}/users/${target.userId}/unblock`, {
      cookie: admin.cookie,
      params: { userId: target.userId },
      body: {},
    });
    expect((unblocked.body.data?.user as { status: string; blockedReason: string | null }).status).toBe("ACTIVE");
    expect(await auditCount("USER_UNBLOCKED", target.userId)).toBe(1);
    expect((await draft()).status).toBe(201); // mutations work again
  });

  it("never self-blocks, never lets a plain ADMIN block a SUPER_ADMIN, 404s unknown users", async () => {
    const self = await api(blockRoute, "POST", `${BASE}/users/${admin.userId}/block`, {
      cookie: admin.cookie,
      params: { userId: admin.userId },
      body: {},
    });
    expect(self.status).toBe(400);
    expect(self.body.error?.code).toBe("VALIDATION_ERROR");

    const escalation = await api(blockRoute, "POST", `${BASE}/users/${superAdmin.userId}/block`, {
      cookie: admin.cookie,
      params: { userId: superAdmin.userId },
      body: {},
    });
    expect(escalation.status).toBe(403);
    expect(escalation.body.error?.code).toBe("STAFF_ROLE_REQUIRED");
    const sql = getSql();
    const [row] = await sql<{ status: string }[]>`select status::text as status from users where id = ${superAdmin.userId}`;
    expect(row.status).toBe("ACTIVE");

    const unknown = await api(blockRoute, "POST", `${BASE}/users/${randomUUID()}/block`, {
      cookie: admin.cookie,
      params: { userId: randomUUID() },
      body: {},
    });
    expect(unknown.status).toBe(404);
  });
});

describe("admin users — role management boundary", () => {
  const roleCall = (
    targetId: string,
    body: unknown,
    cookie: string,
  ) =>
    api(rolesRoute, "POST", `${BASE}/users/${targetId}/roles`, {
      cookie,
      params: { userId: targetId },
      body,
    });

  it("ADMIN can grant and revoke MODERATOR (audited); the grant actually works", async () => {
    const target = await createTestUserSession("+994523000011");
    const queue = () =>
      api(moderatorQueueRoute, "GET", "http://localhost/api/v1/moderator/listings", { cookie: target.cookie });
    expect((await queue()).status).toBe(403);

    const granted = await roleCall(target.userId, { role: "MODERATOR", action: "GRANT" }, admin.cookie);
    expect(granted.status).toBe(200);
    expect((granted.body.data?.user as { roles: string[] }).roles).toContain("MODERATOR");
    expect(await auditCount("ROLE_GRANTED", target.userId)).toBe(1);
    expect((await queue()).status).toBe(200); // authorization is real, not UI-only

    const revoked = await roleCall(target.userId, { role: "MODERATOR", action: "REVOKE" }, admin.cookie);
    expect((revoked.body.data?.user as { roles: string[] }).roles).not.toContain("MODERATOR");
    expect(await auditCount("ROLE_REVOKED", target.userId)).toBe(1);
    expect((await queue()).status).toBe(403);

    // idempotent repeat revoke: no extra audit rows
    await roleCall(target.userId, { role: "MODERATOR", action: "REVOKE" }, admin.cookie);
    expect(await auditCount("ROLE_REVOKED", target.userId)).toBe(1);
  });

  it("ADMIN cannot grant or revoke ADMIN; SUPER_ADMIN can", async () => {
    const target = await createTestUserSession("+994523000012");
    const denied = await roleCall(target.userId, { role: "ADMIN", action: "GRANT" }, admin.cookie);
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe("STAFF_ROLE_REQUIRED");

    const granted = await roleCall(target.userId, { role: "ADMIN", action: "GRANT" }, superAdmin.cookie);
    expect(granted.status).toBe(200);
    expect((granted.body.data?.user as { roles: string[] }).roles).toContain("ADMIN");
    // ...and an ADMIN cannot strip another ADMIN either
    const strip = await roleCall(target.userId, { role: "ADMIN", action: "REVOKE" }, secondAdmin.cookie);
    expect(strip.status).toBe(403);
    const revoked = await roleCall(target.userId, { role: "ADMIN", action: "REVOKE" }, superAdmin.cookie);
    expect((revoked.body.data?.user as { roles: string[] }).roles).not.toContain("ADMIN");
  });

  it("SUPER_ADMIN is never grantable or revocable through the API, and self-changes are refused", async () => {
    const viaEnum = await roleCall(
      plainUser.userId,
      { role: "SUPER_ADMIN", action: "GRANT" },
      superAdmin.cookie,
    );
    expect(viaEnum.status).toBe(400); // rejected at the schema — the capability does not exist

    const self = await roleCall(admin.userId, { role: "MODERATOR", action: "GRANT" }, admin.cookie);
    expect(self.status).toBe(400);
    expect(self.body.error?.code).toBe("VALIDATION_ERROR");

    const moderatorTry = await roleCall(
      plainUser.userId,
      { role: "MODERATOR", action: "GRANT" },
      moderator.cookie,
    );
    expect(moderatorTry.status).toBe(403);
  });
});

describe("admin listings — filters and the unsuspension policy", () => {
  it("filters by status, category, public id and owner phone", async () => {
    const suspended = await insertListing(seller.userId, { status: "SUSPENDED" });
    await insertListing(seller.userId, { status: "ACTIVE" });
    const byStatus = await api(listingsRoute, "GET", `${BASE}/listings?status=SUSPENDED`, {
      cookie: admin.cookie,
    });
    const statusItems = (byStatus.body.data as { items: { status: string }[] }).items;
    expect(statusItems.length).toBeGreaterThan(0);
    for (const item of statusItems) expect(item.status).toBe("SUSPENDED");

    const byPublicId = await api(
      listingsRoute,
      "GET",
      `${BASE}/listings?public_id=${suspended.publicId}`,
      { cookie: admin.cookie },
    );
    const idItems = (byPublicId.body.data as { items: { id: string }[] }).items;
    expect(idItems).toHaveLength(1);
    expect(idItems[0].id).toBe(suspended.id);

    const byOwner = await api(
      listingsRoute,
      "GET",
      `${BASE}/listings?owner_phone=%2B994523000007`,
      { cookie: admin.cookie },
    );
    const ownerItems = (byOwner.body.data as { items: { ownerPhoneMasked: string }[] }).items;
    expect(ownerItems.length).toBeGreaterThan(0);
    for (const item of ownerItems) {
      expect(item.ownerPhoneMasked).not.toContain("+994523000007");
    }
  });

  it("restores a SUSPENDED listing with remaining time to ACTIVE — exactly once, audited, publicly live again", async () => {
    const listing = await insertListing(seller.userId, { status: "SUSPENDED", expiresOffsetDays: 10 });
    await expect(publicDetail(Number(listing.publicId))).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
    const r = await api(unsuspendRoute, "POST", `${BASE}/listings/${listing.id}/unsuspend`, {
      cookie: admin.cookie,
      params: { listingId: listing.id },
      body: {},
    });
    expect(r.status).toBe(200);
    expect((r.body.data?.listing as { status: string }).status).toBe("ACTIVE");
    expect((await publicDetail(Number(listing.publicId))).listing.status).toBe("ACTIVE");
    const sql = getSql();
    const [effects] = await sql<{ history: string; outbox: string; not_extended: boolean }[]>`
      select
        (select count(*)::text from listing_status_history
          where listing_id = ${listing.id} and to_status = 'ACTIVE' and reason_code = 'ADMIN_UNSUSPEND') as history,
        (select count(*)::text from outbox_events
          where aggregate_id = ${listing.id} and event_type = 'LISTING_UNSUSPENDED') as outbox,
        (select current_expires_at <= now() + interval '10 days' from listings where id = ${listing.id}) as not_extended
    `;
    expect(Number(effects.history)).toBe(1);
    expect(Number(effects.outbox)).toBe(1);
    expect(await auditCount("LISTING_UNSUSPENDED", listing.id)).toBe(1);
    expect(effects.not_extended).toBe(true); // restoration never extended the paid period

    // second attempt: no longer suspended → refused, no duplicate effects
    const again = await api(unsuspendRoute, "POST", `${BASE}/listings/${listing.id}/unsuspend`, {
      cookie: admin.cookie,
      params: { listingId: listing.id },
      body: {},
    });
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("MODERATION_INVALID_STATE");
    expect(await auditCount("LISTING_UNSUSPENDED", listing.id)).toBe(1);
  });

  it("routes a SUSPENDED listing whose period lapsed to EXPIRED (renewal flow), never back to ACTIVE", async () => {
    const sql = getSql();
    const listing = await insertListing(seller.userId, { status: "SUSPENDED" });
    await sql`update listings set current_expires_at = now() - interval '1 day' where id = ${listing.id}`;
    const r = await api(unsuspendRoute, "POST", `${BASE}/listings/${listing.id}/unsuspend`, {
      cookie: superAdmin.cookie,
      params: { listingId: listing.id },
      body: {},
    });
    expect(r.status).toBe(200);
    expect((r.body.data?.listing as { status: string }).status).toBe("EXPIRED");
    // accepted Phase 4.8 read model: EXPIRED gets only the limited,
    // non-contactable detail view and never re-enters public lists
    const limited = await publicDetail(Number(listing.publicId));
    expect(limited.listing.status).toBe("EXPIRED");
    expect(limited.listing.contactable).toBe(false);
    const [row] = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_status_history
      where listing_id = ${listing.id} and to_status = 'EXPIRED' and reason_code = 'ADMIN_UNSUSPEND'
    `;
    expect(Number(row.n)).toBe(1);
  });

  it("refuses non-suspended listings and unknown ids", async () => {
    const active = await insertListing(seller.userId, { status: "ACTIVE" });
    const wrongState = await api(unsuspendRoute, "POST", `${BASE}/listings/${active.id}/unsuspend`, {
      cookie: admin.cookie,
      params: { listingId: active.id },
      body: {},
    });
    expect(wrongState.status).toBe(409);
    expect(wrongState.body.error?.code).toBe("MODERATION_INVALID_STATE");
    const unknownId = randomUUID();
    const unknown = await api(unsuspendRoute, "POST", `${BASE}/listings/${unknownId}/unsuspend`, {
      cookie: admin.cookie,
      params: { listingId: unknownId },
      body: {},
    });
    expect(unknown.status).toBe(404);
  });
});

describe("admin reports workflow", () => {
  async function insertReport(listingId: string, status = "OPEN"): Promise<string> {
    const sql = getSql();
    const [row] = await sql<{ id: string }[]>`
      insert into listing_reports (listing_id, reason_code, note, status)
      values (${listingId}, 'FRAUD_SUSPECTED', 'Şübhəli elan', ${status}::report_status)
      returning id
    `;
    return row.id;
  }

  it("lists open reports, resolves and dismisses them exactly once (audited)", async () => {
    const listing = await insertListing(seller.userId);
    const toResolve = await insertReport(listing.id);
    const toDismiss = await insertReport(listing.id);

    const open = await api(reportsRoute, "GET", `${BASE}/reports?status=OPEN`, { cookie: admin.cookie });
    const openIds = (open.body.data as { items: { id: string; status: string }[] }).items.map((r) => r.id);
    expect(openIds).toContain(toResolve);
    expect(openIds).toContain(toDismiss);

    const resolved = await api(resolveReportRoute, "POST", `${BASE}/reports/${toResolve}/resolve`, {
      cookie: admin.cookie,
      params: { reportId: toResolve },
      body: { status: "RESOLVED" },
    });
    expect(resolved.status).toBe(200);
    expect(await auditCount("REPORT_RESOLVED", toResolve)).toBe(1);

    const dismissed = await api(resolveReportRoute, "POST", `${BASE}/reports/${toDismiss}/resolve`, {
      cookie: admin.cookie,
      params: { reportId: toDismiss },
      body: { status: "DISMISSED" },
    });
    expect(dismissed.status).toBe(200);
    expect(await auditCount("REPORT_DISMISSED", toDismiss)).toBe(1);

    // a closed report cannot be re-resolved
    const again = await api(resolveReportRoute, "POST", `${BASE}/reports/${toResolve}/resolve`, {
      cookie: admin.cookie,
      params: { reportId: toResolve },
      body: { status: "DISMISSED" },
    });
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("MODERATION_INVALID_STATE");
    const sql = getSql();
    const [row] = await sql<{ status: string; resolved_by: string }[]>`
      select status::text as status, resolved_by::text as resolved_by
      from listing_reports where id = ${toResolve}
    `;
    expect(row.status).toBe("RESOLVED");
    expect(row.resolved_by).toBe(admin.userId);
  });
});

describe("admin catalog — deactivation, never deletion", () => {
  it("toggles a brand's activation (audited) and rejects unknown entities/ids", async () => {
    const sql = getSql();
    const [brand] = await sql<{ id: string }[]>`
      insert into brands (name, slug, is_active) values ('AdminTestMarka', 'admin-test-marka', true)
      returning id
    `;
    const url = `${BASE}/catalog/brands`;
    const deactivate = await api(catalogToggleRoute, "POST", url, {
      cookie: admin.cookie,
      params: { entity: "brands" },
      body: { id: brand.id, is_active: false },
    });
    expect(deactivate.status).toBe(200);
    const list = await api(catalogRoute, "GET", url, { cookie: admin.cookie, params: { entity: "brands" } });
    const item = (list.body.data as { items: { id: string; is_active: boolean }[] }).items.find(
      (row) => row.id === brand.id,
    );
    expect(item?.is_active).toBe(false);
    expect(await auditCount("CATALOG_DEACTIVATED", brand.id)).toBe(1);
    // the row still exists — deactivation, not deletion
    const [still] = await sql<{ n: string }[]>`select count(*)::text as n from brands where id = ${brand.id}`;
    expect(Number(still.n)).toBe(1);

    const reactivate = await api(catalogToggleRoute, "POST", url, {
      cookie: admin.cookie,
      params: { entity: "brands" },
      body: { id: brand.id, is_active: true },
    });
    expect(reactivate.status).toBe(200);
    expect(await auditCount("CATALOG_ACTIVATED", brand.id)).toBe(1);

    const unknownEntity = await api(catalogToggleRoute, "POST", `${BASE}/catalog/users`, {
      cookie: admin.cookie,
      params: { entity: "users" },
      body: { id: brand.id, is_active: false },
    });
    expect(unknownEntity.status).toBe(400);
    const unknownId = await api(catalogToggleRoute, "POST", url, {
      cookie: admin.cookie,
      params: { entity: "brands" },
      body: { id: randomUUID(), is_active: false },
    });
    expect(unknownId.status).toBe(404);
  });
});

describe("admin audit explorer — read-only over an append-only log", () => {
  it("filters by action, entity and actor type; masks actor phones", async () => {
    const target = await createTestUserSession("+994523000013");
    await api(blockRoute, "POST", `${BASE}/users/${target.userId}/block`, {
      cookie: admin.cookie,
      params: { userId: target.userId },
      body: { reason: "audit-filter-fixture" },
    });
    const r = await api(
      auditRoute,
      "GET",
      `${BASE}/audit?action=USER_BLOCKED&entity_id=${target.userId}&actor_type=ADMIN`,
      { cookie: admin.cookie },
    );
    expect(r.status).toBe(200);
    const items = (r.body.data as {
      items: { action: string; entityId: string; actorPhoneMasked: string | null; afterData: unknown }[];
    }).items;
    expect(items).toHaveLength(1);
    expect(items[0].action).toBe("USER_BLOCKED");
    expect(items[0].entityId).toBe(target.userId);
    expect(items[0].actorPhoneMasked).not.toContain("+994523000002");
    expect(JSON.stringify(r.body)).not.toContain("+994523000002");
    // lowercase/injection-shaped action filters are refused at validation
    const bad = await api(auditRoute, "GET", `${BASE}/audit?action=${encodeURIComponent("x'; drop--")}`, {
      cookie: admin.cookie,
    });
    expect(bad.status).toBe(400);
  });

  it("the audit log itself rejects UPDATE and DELETE at the database layer", async () => {
    const sql = getSql();
    const [row] = await sql<{ id: string }[]>`select id from audit_logs limit 1`;
    await expect(
      sql`update audit_logs set action = 'TAMPERED' where id = ${row.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(sql`delete from audit_logs where id = ${row.id}`).rejects.toThrow(/append-only/);
  });
});
