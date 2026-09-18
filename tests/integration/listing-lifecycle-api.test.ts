import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { POST as deactivateRoute } from "@/app/api/v1/me/listings/[listingId]/deactivate/route";
import { POST as reactivateRoute } from "@/app/api/v1/me/listings/[listingId]/reactivate/route";
import type { AuthContext } from "@/auth/current-user";
import { myListings } from "@/services/my-listings";
import { getOrCreateEditRevision } from "@/services/listing-lifecycle";
import { createTestUserSession } from "./helpers/session";

/**
 * O.12 Stage B — seller lifecycle HTTP surface + My Listings read
 * model. The lifecycle core itself is Stage-A-tested; this file locks
 * the HTTP mapping (auth, anti-oracle, envelopes, outcomes) and the
 * DTO/classification contract.
 */

let seller: { userId: string; cookie: string };
let stranger: { userId: string; cookie: string };
let blocked: { userId: string; cookie: string };
let carCat: string;
let brand: string;
let model: string;
let city: string;

const auth = () => ({ user: { id: seller.userId } }) as AuthContext;

interface Envelope {
  data?: Record<string, unknown>;
  error?: { code: string };
}

async function call(
  route: typeof deactivateRoute,
  listingId: string,
  body: unknown,
  cookie: string,
): Promise<{ status: number; body: Envelope }> {
  const request = new Request(`http://localhost/api/v1/me/listings/${listingId}/x`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "http://localhost",
      host: "localhost",
    },
    body: JSON.stringify(body),
  });
  const response = await route(request, { params: Promise.resolve({ listingId }) });
  return { status: response.status, body: (await response.json()) as Envelope };
}

async function insertListing(spec: {
  status?: string;
  deactivated?: boolean;
  requested?: boolean;
  expiresOffsetMin?: number;
  owner?: string;
}): Promise<{ id: string; publicId: number; revision: number }> {
  const sql = getSql();
  const [row] = await sql<{ id: string; public_id: string; revision: number }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
      mileage, credit_available, barter_available, description, contact_phone_e164, seller_name,
      status, submitted_at, published_at, current_expires_at,
      seller_deactivated_at, seller_reactivation_requested_at)
    values (${spec.owner ?? seller.userId}, ${carCat}, ${brand}, ${model}, ${city}, 2021, 1500000,
      40000, false, false, 'O12B təsviri', '+994501234567', 'O12B Satıcı',
      ${spec.status ?? "ACTIVE"}::listing_status, now() - interval '4 days',
      now() - interval '3 days',
      now() + (${spec.expiresOffsetMin ?? 60 * 24 * 10} || ' minutes')::interval,
      ${spec.deactivated === true ? sql`now()` : null},
      ${spec.requested === true ? sql`now()` : null})
    returning id, public_id::text as public_id, revision
  `;
  await sql`
    insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
    values (${row.id}, ${`listings/${randomUUID()}.webp`}, 0, true, 'image/webp', 1000, 1600, 900),
           (${row.id}, ${`listings/${randomUUID()}.webp`}, 1, false, 'image/webp', 1200, 1600, 900),
           (${row.id}, ${`listings/${randomUUID()}.webp`}, 2, false, 'image/webp', 1400, 1600, 900)
  `;
  return { id: row.id, publicId: Number(row.public_id), revision: row.revision };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  const sql = getSql();
  seller = await createTestUserSession("+994527000001");
  stranger = await createTestUserSession("+994527000002");
  blocked = await createTestUserSession("+994527000003", { blocked: true });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('O12BBrand', 'o12b-brand') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  model = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'O12BModel', 'o12b-model') returning id`)[0].id;
  city = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('O12BŞəhər', 'o12b-seher', 97) returning id`)[0].id;
});

afterAll(async () => {
  await closeSql();
});

describe("POST /me/listings/{id}/deactivate", () => {
  it("owner success returns the lifecycle state; children/clocks untouched", async () => {
    const listing = await insertListing({});
    const sql = getSql();
    const before = (await sql<{ current_expires_at: Date }[]>`
      select current_expires_at from listings where id = ${listing.id}
    `)[0];
    const r = await call(deactivateRoute, listing.id, { expected_revision: listing.revision }, seller.cookie);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ listingId: listing.id, alreadyDeactivated: false });
    const after = (await sql<{ current_expires_at: Date; seller_deactivated_at: Date | null }[]>`
      select current_expires_at, seller_deactivated_at from listings where id = ${listing.id}
    `)[0];
    expect(after.seller_deactivated_at).not.toBeNull();
    expect(after.current_expires_at.getTime()).toBe(before.current_expires_at.getTime());

    // idempotent repeat (Stage A convention) via HTTP
    const again = await call(
      deactivateRoute,
      listing.id,
      { expected_revision: (r.body.data as { revision: number }).revision },
      seller.cookie,
    );
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ alreadyDeactivated: true });
  });

  it("anti-oracle for non-owners; blocked users refused; stale revision typed", async () => {
    const listing = await insertListing({});
    const foreign = await call(deactivateRoute, listing.id, { expected_revision: 1 }, stranger.cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error?.code).toBe("LISTING_NOT_FOUND");
    const blockedTry = await call(deactivateRoute, listing.id, { expected_revision: 1 }, blocked.cookie);
    expect(blockedTry.status).toBe(403);
    expect(blockedTry.body.error?.code).toBe("USER_BLOCKED");
    const stale = await call(deactivateRoute, listing.id, { expected_revision: 999 }, seller.cookie);
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("LISTING_REVISION_CONFLICT");
    const expired = await insertListing({ status: "EXPIRED", expiresOffsetMin: -60 });
    const invalid = await call(deactivateRoute, expired.id, { expected_revision: 1 }, seller.cookie);
    expect(invalid.status).toBe(409);
    expect(invalid.body.error?.code).toBe("LISTING_LIFECYCLE_CONFLICT");
  });
});

describe("POST /me/listings/{id}/reactivate", () => {
  it("maps every structured outcome deterministically", async () => {
    // direct
    const direct = await insertListing({ deactivated: true });
    const r1 = await call(reactivateRoute, direct.id, { expected_revision: direct.revision }, seller.cookie);
    expect(r1.status).toBe(200);
    expect(r1.body.data).toMatchObject({ outcome: "REACTIVATED" });

    // EDIT_DRAFT
    const withDraft = await insertListing({ deactivated: true });
    await getOrCreateEditRevision(auth(), withDraft.id);
    const r2 = await call(reactivateRoute, withDraft.id, { expected_revision: withDraft.revision }, seller.cookie);
    expect(r2.body.data).toMatchObject({ outcome: "EDIT_INCOMPLETE", reactivationRequested: false });

    // PENDING → intent persisted; repeat idempotent
    const withPending = await insertListing({ deactivated: true });
    const rev = await getOrCreateEditRevision(auth(), withPending.id);
    const sql = getSql();
    await sql`update listing_edit_revisions set status = 'PENDING_MODERATION', submitted_at = now() where id = ${rev.id}`;
    const r3 = await call(reactivateRoute, withPending.id, { expected_revision: withPending.revision }, seller.cookie);
    expect(r3.body.data).toMatchObject({ outcome: "AWAITING_MODERATION", reactivationRequested: true });
    const bumped = (r3.body.data as { revision: number }).revision;
    const r3b = await call(reactivateRoute, withPending.id, { expected_revision: bumped }, seller.cookie);
    expect(r3b.body.data).toMatchObject({ outcome: "AWAITING_MODERATION", reactivationRequested: true });

    // CORRECTION → intent persisted
    const withCorrection = await insertListing({ deactivated: true });
    const rev2 = await getOrCreateEditRevision(auth(), withCorrection.id);
    await sql`update listing_edit_revisions set status = 'CORRECTION_REQUIRED' where id = ${rev2.id}`;
    const r4 = await call(reactivateRoute, withCorrection.id, { expected_revision: withCorrection.revision }, seller.cookie);
    expect(r4.body.data).toMatchObject({ outcome: "CORRECTION_REQUIRED", reactivationRequested: true });

    // EXPIRED → renewal remains the only path (no free period)
    const expired = await insertListing({ status: "EXPIRED", deactivated: true, expiresOffsetMin: -60 });
    const r5 = await call(reactivateRoute, expired.id, { expected_revision: expired.revision }, seller.cookie);
    expect(r5.body.data).toMatchObject({ outcome: "RENEWAL_REQUIRED" });
    const periods = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_periods where listing_id = ${expired.id}
    `;
    expect(Number(periods[0].n)).toBe(0);
  });

  it("SUSPENDED/SOLD refused; blocked refused; stale revision conflicts", async () => {
    const suspended = await insertListing({ status: "SUSPENDED", deactivated: true });
    const r1 = await call(reactivateRoute, suspended.id, { expected_revision: 1 }, seller.cookie);
    expect(r1.status).toBe(409);
    expect(r1.body.error?.code).toBe("LISTING_LIFECYCLE_CONFLICT");
    const sold = await insertListing({ status: "SOLD", deactivated: true });
    const r2 = await call(reactivateRoute, sold.id, { expected_revision: 1 }, seller.cookie);
    expect(r2.status).toBe(409);
    const blockedTry = await call(reactivateRoute, suspended.id, { expected_revision: 1 }, blocked.cookie);
    expect(blockedTry.status).toBe(403);
    const target = await insertListing({ deactivated: true });
    const stale = await call(reactivateRoute, target.id, { expected_revision: 999 }, seller.cookie);
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("LISTING_REVISION_CONFLICT");
  });
});

describe("My Listings read model", () => {
  it("classifies and filters per the sealed precedence; states survive re-read", async () => {
    const sql = getSql();
    // dedicated user isolates list assertions
    const isolated = await createTestUserSession("+994527000004");
    const isoAuth = { user: { id: isolated.userId } } as AuthContext;
    const mk = (spec: Parameters<typeof insertListing>[0]) =>
      insertListing({ ...spec, owner: isolated.userId });

    const active = await mk({});
    const deactivated = await mk({ deactivated: true });
    const deactPendingReq = await mk({ deactivated: true, requested: true });
    const rev = await getOrCreateEditRevision(isoAuth, deactPendingReq.id);
    await sql`update listing_edit_revisions set status = 'PENDING_MODERATION', submitted_at = now() where id = ${rev.id}`;
    const activePending = await mk({});
    const rev2 = await getOrCreateEditRevision(isoAuth, activePending.id);
    await sql`update listing_edit_revisions set status = 'PENDING_MODERATION', submitted_at = now() where id = ${rev2.id}`;
    const expiredDeactivated = await mk({ deactivated: true, expiresOffsetMin: -30 });

    const all = await myListings(isoAuth, "all");
    const by = (id: string) => all.find((c) => c.id === id)!;

    expect(by(active.id).management.primary).toBe("ACTIVE");
    expect(by(deactivated.id).management.primary).toBe("DEACTIVATED");
    // ACTIVE + pending edit remains primarily ACTIVE with secondary chip data
    expect(by(activePending.id).management.primary).toBe("ACTIVE");
    expect(by(activePending.id).editRevision?.status).toBe("PENDING_MODERATION");
    expect(by(activePending.id).editRevision?.submittedAt).not.toBeNull();
    // requested state is server-restored (no client inference)
    expect(by(deactPendingReq.id).reactivationRequested).toBe(true);
    expect(by(deactPendingReq.id).management.awaitingActivation).toBe(true);
    // expired beats deactivated
    expect(by(expiredDeactivated.id).management.primary).toBe("EXPIRED");

    // Deaktiv filter reaches deactivated listings (incl. expired+deactivated)
    const deaktiv = await myListings(isoAuth, "deactivated");
    const deaktivIds = deaktiv.map((c) => c.id);
    expect(deaktivIds).toContain(deactivated.id);
    expect(deaktivIds).toContain(deactPendingReq.id);
    expect(deaktivIds).toContain(expiredDeactivated.id);
    expect(deaktivIds).not.toContain(active.id);

    // Aktiv tab never carries Deaktiv-classified cards
    const aktiv = await myListings(isoAuth, "active");
    const aktivIds = aktiv.map((c) => c.id);
    expect(aktivIds).toContain(active.id);
    expect(aktivIds).toContain(activePending.id);
    expect(aktivIds).not.toContain(deactivated.id);
    expect(aktivIds).not.toContain(deactPendingReq.id);
  });
});
