import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/auth/current-user";
import { closeSql, getSql, withTransaction } from "@/lib/server/db/client";
import { expireListingsBatch } from "@/repositories/lifecycle-jobs";
import {
  getOpenEditRevision,
  listEditRevisionImages,
  updateEditRevisionData,
} from "@/repositories/listing-edit-revisions";
import { lockListingForLifecycle } from "@/repositories/listing-lifecycle";
import { homeData, publicDetail, searchMarketplace } from "@/services/marketplace";
import {
  buildEditSnapshot,
  cancelOpenEditRevision,
  deactivateListing,
  getOrCreateEditRevision,
  reactivateListing,
  tryFinalizeSellerReactivationById,
} from "@/services/listing-lifecycle";
import { createTestUserSession } from "./helpers/session";

/**
 * O.12 Stage A — schema, revision foundation, and lifecycle core.
 * Shared ephemeral DB: fixtures use o12-* slugs/codes and assertions
 * scope to this file's listings only.
 */

let ownerId: string;
let otherUserId: string;
let carCat: string;
let brand: string;
let model: string;
let city: string;
let featA: string;
let featB: string;

const auth = () => ({ user: { id: ownerId } }) as AuthContext;

interface Fixture {
  id: string;
  publicId: number;
}

async function insertListing(spec: {
  status?: string;
  expiresOffsetMin?: number;
  features?: string[];
  deactivated?: boolean;
}): Promise<Fixture> {
  const sql = getSql();
  const status = spec.status ?? "ACTIVE";
  const expiresOffset = spec.expiresOffsetMin ?? 60 * 24 * 20;
  const [row] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor, mileage,
      credit_available, barter_available, description, contact_phone_e164, seller_name, status,
      submitted_at, published_at, current_expires_at, seller_deactivated_at)
    values (${ownerId}, ${carCat}, ${brand}, ${model}, ${city}, 2021, 2500000, 50000,
      false, false, 'O12 təsviri', '+994501234567', 'O12 Satıcı', ${status}::listing_status,
      now() - interval '4 days', now() - interval '3 days',
      now() + (${expiresOffset} || ' minutes')::interval,
      ${spec.deactivated === true ? sql`now()` : null})
    returning id, public_id::text as public_id
  `;
  await sql`
    insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
    values (${row.id}, ${`listings/${randomUUID()}.webp`}, 0, true, 'image/webp', 1000, 1600, 900),
           (${row.id}, ${`listings/${randomUUID()}.webp`}, 1, false, 'image/webp', 1200, 1600, 900),
           (${row.id}, ${`listings/${randomUUID()}.webp`}, 2, false, 'image/webp', 1400, 1600, 900)
  `;
  for (const f of spec.features ?? []) {
    await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${f})`;
  }
  return { id: row.id, publicId: Number(row.public_id) };
}

async function promote(listingId: string, type: "BOOST" | "PREMIUM"): Promise<void> {
  const sql = getSql();
  const [pay] = await sql<{ id: string }[]>`
    insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status, provider)
    values (${ownerId}, ${listingId}, ${type}::payment_type, 0, ${`o12promo:${listingId}:${type}`}, 'SUCCESS', 'KAPITAL')
    returning id
  `;
  await sql`
    insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
    values (${listingId}, ${type}::promotion_type, ${pay.id}, now() - interval '1 hour', now() + interval '7 days', 'ACTIVE', 7, 0)
  `;
}

async function listingRow(id: string) {
  const sql = getSql();
  const rows = await sql<
    {
      status: string;
      revision: number;
      current_expires_at: Date;
      seller_deactivated_at: Date | null;
      seller_reactivation_requested_at: Date | null;
    }[]
  >`
    select status, revision, current_expires_at, seller_deactivated_at, seller_reactivation_requested_at
    from listings where id = ${id}
  `;
  return rows[0];
}

async function searchIds(): Promise<number[]> {
  const result = await searchMarketplace({ category: "CAR", brand_id: brand, sort: "NEWEST", limit: 48 });
  return [...result.promoted, ...result.items].map((i) => Number(i.publicId));
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  const sql = getSql();
  ownerId = (await createTestUserSession("+994517000001")).userId;
  otherUserId = (await createTestUserSession("+994517000002")).userId;
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  const [b] = await sql<{ id: string }[]>`insert into brands (name, slug) values ('O12Brand', 'o12-brand') returning id`;
  brand = b.id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  model = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'O12Model', 'o12-model') returning id`)[0].id;
  city = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('O12Şəhər', 'o12-seher', 96) returning id`)[0].id;
  featA = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O12_FEAT_A', 'O12 A', 'SAFETY') returning id`)[0].id;
  featB = (await sql<{ id: string }[]>`insert into features (code, name_az, category_id, group_code) values ('O12_FEAT_B', 'O12 B', ${carCat}, 'COMFORT') returning id`)[0].id;
});

afterAll(async () => {
  await closeSql();
});

describe("migration / schema integrity", () => {
  it("adds both nullable seller timestamps; existing rows are NULL", async () => {
    const sql = getSql();
    const cols = await sql<{ column_name: string; is_nullable: string }[]>`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'listings'
        and column_name in ('seller_deactivated_at', 'seller_reactivation_requested_at')
      order by column_name
    `;
    expect(cols).toEqual([
      { column_name: "seller_deactivated_at", is_nullable: "YES" },
      { column_name: "seller_reactivation_requested_at", is_nullable: "YES" },
    ]);
    // no-backfill contract, asserted hermetically (other test files now
    // legitimately set these flags on their own fixtures): a row that
    // never touches the columns gets NULL for both.
    const fresh = await insertListing({});
    const [defaults] = await sql<
      { seller_deactivated_at: Date | null; seller_reactivation_requested_at: Date | null }[]
    >`
      select seller_deactivated_at, seller_reactivation_requested_at
      from listings where id = ${fresh.id}
    `;
    expect(defaults.seller_deactivated_at).toBeNull();
    expect(defaults.seller_reactivation_requested_at).toBeNull();
  });

  it("edit_revision_status enum has exactly the six sealed values", async () => {
    const sql = getSql();
    const rows = await sql<{ enumlabel: string }[]>`
      select e.enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'edit_revision_status'
      order by e.enumsortorder
    `;
    expect(rows.map((r) => r.enumlabel)).toEqual([
      "EDIT_DRAFT",
      "PENDING_MODERATION",
      "CORRECTION_REQUIRED",
      "APPROVED",
      "REJECTED",
      "CANCELLED",
    ]);
  });

  it("revision counter must stay positive and moderation_reviews gained the additive edit columns", async () => {
    const sql = getSql();
    const listing = await insertListing({});
    await expect(
      sql`insert into listing_edit_revisions (listing_id, revision) values (${listing.id}, 0)`,
    ).rejects.toThrow();
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'moderation_reviews'
        and column_name in ('edit_revision_id', 'edit_revision_no')
      order by column_name
    `;
    expect(cols.map((c) => c.column_name)).toEqual(["edit_revision_id", "edit_revision_no"]);
  });

  it("DB-enforces one OPEN revision per listing; terminal rows never block a new edit", async () => {
    const sql = getSql();
    const listing = await insertListing({});
    await sql`insert into listing_edit_revisions (listing_id) values (${listing.id})`;
    await expect(
      sql`insert into listing_edit_revisions (listing_id) values (${listing.id})`,
    ).rejects.toThrow(/duplicate key|unique/i);
    // terminal states free the slot — several terminals may coexist
    await sql`update listing_edit_revisions set status = 'REJECTED', decided_at = now() where listing_id = ${listing.id}`;
    await sql`insert into listing_edit_revisions (listing_id, status, decided_at) values (${listing.id}, 'CANCELLED', now())`;
    const again = await sql<{ id: string }[]>`
      insert into listing_edit_revisions (listing_id) values (${listing.id}) returning id
    `;
    expect(again).toHaveLength(1);
    const total = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_edit_revisions where listing_id = ${listing.id}
    `;
    expect(Number(total[0].n)).toBe(3);
  });

  it("staged images enforce one primary per revision and cascade with the revision", async () => {
    const sql = getSql();
    const listing = await insertListing({});
    const [rev] = await sql<{ id: string }[]>`
      insert into listing_edit_revisions (listing_id) values (${listing.id}) returning id
    `;
    await sql`
      insert into listing_edit_images (edit_revision_id, storage_path, is_primary, mime_type, file_size_bytes)
      values (${rev.id}, 'listings/o12-a.webp', true, 'image/webp', 1000)
    `;
    await expect(
      sql`
        insert into listing_edit_images (edit_revision_id, storage_path, is_primary, mime_type, file_size_bytes)
        values (${rev.id}, 'listings/o12-b.webp', true, 'image/webp', 1000)
      `,
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("edit revision snapshot", () => {
  it("creates a full editable snapshot without touching approved content", async () => {
    const listing = await insertListing({ features: [featA, featB] });
    const dto = await getOrCreateEditRevision(auth(), listing.id);
    expect(dto.listingId).toBe(listing.id);
    expect(dto.status).toBe("EDIT_DRAFT");
    expect(dto.data).toMatchObject({
      category: "CAR",
      brand_id: brand,
      model_id: model,
      year: 2021,
      price_minor: 2500000,
      mileage: 50000,
      city_id: city,
      description: "O12 təsviri",
      contact_phone: "+994501234567",
      seller_name: "O12 Satıcı",
    });
    expect((dto.data.feature_ids as string[]).sort()).toEqual([featA, featB].sort());
    // promotion-intent fields are sealed OUT of edit scope
    expect("premium_intent_package_id" in dto.data).toBe(false);
    expect("boost_intent_package_id" in dto.data).toBe(false);
    // lifecycle fields never enter the snapshot
    for (const k of ["status", "current_expires_at", "seller_deactivated_at"]) {
      expect(k in dto.data).toBe(false);
    }

    // staged gallery: row copies with SAME storage paths, order, primary
    const sql = getSql();
    const staged = await listEditRevisionImages(sql, dto.id);
    const approved = await sql<{ storage_path: string; sort_order: number; is_primary: boolean }[]>`
      select storage_path, sort_order, is_primary from listing_images
      where listing_id = ${listing.id} order by sort_order
    `;
    expect(staged.map((s) => [s.storage_path, s.sort_order, s.is_primary])).toEqual(
      approved.map((a) => [a.storage_path, a.sort_order, a.is_primary]),
    );

    // approved side untouched
    const feats = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_features where listing_id = ${listing.id}
    `;
    expect(Number(feats[0].n)).toBe(2);

    // create-or-get returns THE same open revision
    const again = await getOrCreateEditRevision(auth(), listing.id);
    expect(again.id).toBe(dto.id);
  });

  it("refuses creation outside ACTIVE/EXPIRED and for non-owners/deleted", async () => {
    const suspended = await insertListing({ status: "SUSPENDED" });
    await expect(getOrCreateEditRevision(auth(), suspended.id)).rejects.toMatchObject({
      code: "LISTING_LIFECYCLE_CONFLICT",
    });
    const sold = await insertListing({ status: "SOLD" });
    await expect(getOrCreateEditRevision(auth(), sold.id)).rejects.toMatchObject({
      code: "LISTING_LIFECYCLE_CONFLICT",
    });
    const active = await insertListing({});
    await expect(
      getOrCreateEditRevision({ user: { id: otherUserId } } as AuthContext, active.id),
    ).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
    const expired = await insertListing({ status: "EXPIRED", expiresOffsetMin: -60 });
    const dto = await getOrCreateEditRevision(auth(), expired.id);
    expect(dto.status).toBe("EDIT_DRAFT"); // expired listings may edit (moderation-first)
  });
});

describe("public leak protection (critical O.12 invariant)", () => {
  it("revision/staged mutations never change any public buyer surface", async () => {
    const listing = await insertListing({ features: [featA] });
    const before = await publicDetail(listing.publicId);
    const dto = await getOrCreateEditRevision(auth(), listing.id);

    const sql = getSql();
    // mutate scalars + staged feature_ids + staged images (test-level primitives)
    await updateEditRevisionData(sql, {
      revisionId: dto.id,
      expectedRevision: dto.revision,
      data: { price_minor: 990000, description: "Yeni gizli təsvir", feature_ids: [featB] },
    });
    await sql`delete from listing_edit_images where edit_revision_id = ${dto.id}`;
    await sql`
      insert into listing_edit_images (edit_revision_id, storage_path, is_primary, mime_type, file_size_bytes)
      values (${dto.id}, 'listings/o12-staged-only.webp', true, 'image/webp', 1000)
    `;

    const after = await publicDetail(listing.publicId);
    expect(after.listing.priceMinor).toBe(before.listing.priceMinor);
    expect(after.listing.description).toBe(before.listing.description);
    expect(after.listing.features.map((f) => f.code)).toEqual(["O12_FEAT_A"]);
    expect(after.listing.images.length).toBe(before.listing.images.length);
    const publicJson = JSON.stringify(after);
    expect(publicJson).not.toContain("o12-staged-only");
    expect(publicJson).not.toContain("Yeni gizli təsvir");

    // search card unchanged too
    const cards = await searchMarketplace({ category: "CAR", brand_id: brand, sort: "NEWEST", limit: 48 });
    const card = [...cards.items, ...cards.promoted].find((c) => Number(c.publicId) === listing.publicId);
    expect(card).toBeDefined();
    expect(Number(card!.priceMinor)).toBe(2500000);
  });
});

describe("cancel edit", () => {
  it("EDIT_DRAFT and CORRECTION_REQUIRED cancel; PENDING conflicts; slot frees; history kept", async () => {
    const listing = await insertListing({});
    const draft = await getOrCreateEditRevision(auth(), listing.id);
    const cancelled = await cancelOpenEditRevision(auth(), listing.id, draft.revision);
    expect(cancelled.status).toBe("CANCELLED");

    // history retained; slot released → a NEW revision is creatable
    const sql = getSql();
    const rows = await sql<{ status: string }[]>`
      select status from listing_edit_revisions where listing_id = ${listing.id} order by created_at
    `;
    expect(rows[0].status).toBe("CANCELLED");
    const second = await getOrCreateEditRevision(auth(), listing.id);
    expect(second.id).not.toBe(draft.id);

    // CORRECTION_REQUIRED cancels; PENDING refuses
    await sql`update listing_edit_revisions set status = 'CORRECTION_REQUIRED' where id = ${second.id}`;
    const fresh = await getOpenEditRevision(sql, listing.id);
    const cancelled2 = await cancelOpenEditRevision(auth(), listing.id, fresh!.revision);
    expect(cancelled2.status).toBe("CANCELLED");

    const third = await getOrCreateEditRevision(auth(), listing.id);
    await sql`update listing_edit_revisions set status = 'PENDING_MODERATION', submitted_at = now() where id = ${third.id}`;
    await expect(cancelOpenEditRevision(auth(), listing.id, third.revision)).rejects.toMatchObject({
      code: "LISTING_LIFECYCLE_CONFLICT",
    });

    // approved content and public output untouched throughout
    const pub = await publicDetail(listing.publicId);
    expect(pub.listing.status).toBe("ACTIVE");
  });

  it("cancelling the activation-vehicle edit clears the reactivation request", async () => {
    const listing = await insertListing({ deactivated: true });
    const rev = await getOrCreateEditRevision(auth(), listing.id);
    const sql = getSql();
    await sql`update listing_edit_revisions set status = 'CORRECTION_REQUIRED' where id = ${rev.id}`;
    const r = await reactivateListing(auth(), listing.id, (await listingRow(listing.id)).revision);
    expect(r.outcome).toBe("CORRECTION_REQUIRED");
    expect((await listingRow(listing.id)).seller_reactivation_requested_at).not.toBeNull();

    const open = await getOpenEditRevision(sql, listing.id);
    await cancelOpenEditRevision(auth(), listing.id, open!.revision);
    const after = await listingRow(listing.id);
    expect(after.seller_reactivation_requested_at).toBeNull(); // stale intent can never publish
    expect(after.seller_deactivated_at).not.toBeNull(); // still hidden
  });
});

describe("seller deactivation", () => {
  it("hides the listing from every fresh public read; clocks and children untouched", async () => {
    const listing = await insertListing({ features: [featA] });
    await promote(listing.id, "PREMIUM");
    await promote(listing.id, "BOOST");

    expect(await searchIds()).toContain(listing.publicId);
    const before = await listingRow(listing.id);

    const result = await deactivateListing(auth(), listing.id, before.revision);
    expect(result.alreadyDeactivated).toBe(false);

    // fresh public reads exclude it everywhere
    expect(await searchIds()).not.toContain(listing.publicId);
    const home = await homeData();
    expect(home.home.premium.items.map((i) => Number(i.publicId))).not.toContain(listing.publicId);
    await expect(publicDetail(listing.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });

    // owner data + clocks + children untouched
    const after = await listingRow(listing.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.current_expires_at.getTime()).toBe(before.current_expires_at.getTime());
    const sql = getSql();
    const promos = await sql<{ starts_at: Date; ends_at: Date; status: string }[]>`
      select starts_at, ends_at, status from listing_promotions where listing_id = ${listing.id}
    `;
    expect(promos).toHaveLength(2);
    for (const p of promos) expect(p.status).toBe("ACTIVE");
    const periods = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_periods where listing_id = ${listing.id}
    `;
    expect(Number(periods[0].n)).toBe(0); // deactivation created none

    // idempotent repeat
    const again = await deactivateListing(auth(), listing.id, after.revision);
    expect(again.alreadyDeactivated).toBe(true);
    expect(again.sellerDeactivatedAt).toBe(result.sellerDeactivatedAt);
  });

  it("only ACTIVE can deactivate; revision conflicts are typed", async () => {
    const expired = await insertListing({ status: "EXPIRED", expiresOffsetMin: -60 });
    await expect(deactivateListing(auth(), expired.id, 1)).rejects.toMatchObject({
      code: "LISTING_LIFECYCLE_CONFLICT",
    });
    const active = await insertListing({});
    await expect(deactivateListing(auth(), active.id, 999)).rejects.toMatchObject({
      code: "LISTING_REVISION_CONFLICT",
    });
  });

  it("pending edit + deactivate: hidden, revision survives, no reactivation request", async () => {
    const listing = await insertListing({});
    const rev = await getOrCreateEditRevision(auth(), listing.id);
    const sql = getSql();
    await sql`update listing_edit_revisions set status = 'PENDING_MODERATION', submitted_at = now() where id = ${rev.id}`;

    await deactivateListing(auth(), listing.id, (await listingRow(listing.id)).revision);
    await expect(publicDetail(listing.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
    const open = await getOpenEditRevision(sql, listing.id);
    expect(open?.id).toBe(rev.id);
    expect(open?.status).toBe("PENDING_MODERATION");
    const row = await listingRow(listing.id);
    expect(row.seller_reactivation_requested_at).toBeNull(); // a future content-only approval cannot resurrect visibility
  });
});

describe("seller reactivation + central finalizer", () => {
  it("direct path: valid + no edit reactivates immediately with zero periods/fees", async () => {
    const listing = await insertListing({ deactivated: true });
    const row = await listingRow(listing.id);
    const result = await reactivateListing(auth(), listing.id, row.revision);
    expect(result.outcome).toBe("REACTIVATED");
    const after = await listingRow(listing.id);
    expect(after.seller_deactivated_at).toBeNull();
    expect(after.seller_reactivation_requested_at).toBeNull(); // no intent residue
    expect(after.current_expires_at.getTime()).toBe(row.current_expires_at.getTime());
    const sql = getSql();
    const periods = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_periods where listing_id = ${listing.id}
    `;
    expect(Number(periods[0].n)).toBe(0);
    expect(await searchIds()).toContain(listing.publicId);
  });

  it("EDIT_DRAFT blocks: no publication of the old version, no intent recorded", async () => {
    const listing = await insertListing({ deactivated: true });
    await getOrCreateEditRevision(auth(), listing.id);
    const row = await listingRow(listing.id);
    const result = await reactivateListing(auth(), listing.id, row.revision);
    expect(result.outcome).toBe("EDIT_INCOMPLETE");
    const after = await listingRow(listing.id);
    expect(after.seller_deactivated_at).not.toBeNull();
    expect(after.seller_reactivation_requested_at).toBeNull();
    await expect(publicDetail(listing.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
  });

  it("PENDING records the request and stays hidden; CORRECTION likewise; request survives resubmit-shaped transitions", async () => {
    const listing = await insertListing({ deactivated: true });
    const rev = await getOrCreateEditRevision(auth(), listing.id);
    const sql = getSql();
    await sql`update listing_edit_revisions set status = 'PENDING_MODERATION', submitted_at = now() where id = ${rev.id}`;
    const r1 = await reactivateListing(auth(), listing.id, (await listingRow(listing.id)).revision);
    expect(r1.outcome).toBe("AWAITING_MODERATION");
    let row = await listingRow(listing.id);
    expect(row.seller_reactivation_requested_at).not.toBeNull();
    expect(row.seller_deactivated_at).not.toBeNull();

    // idempotent re-click keeps the ORIGINAL request timestamp
    const firstAsk = row.seller_reactivation_requested_at!.getTime();
    const r2 = await reactivateListing(auth(), listing.id, row.revision);
    expect(r2.outcome).toBe("AWAITING_MODERATION");
    row = await listingRow(listing.id);
    expect(row.seller_reactivation_requested_at!.getTime()).toBe(firstAsk);

    // correction keeps the request alive
    await sql`update listing_edit_revisions set status = 'CORRECTION_REQUIRED' where id = ${rev.id}`;
    const r3 = await reactivateListing(auth(), listing.id, row.revision);
    expect(r3.outcome).toBe("CORRECTION_REQUIRED");
    row = await listingRow(listing.id);
    expect(row.seller_reactivation_requested_at!.getTime()).toBe(firstAsk);
    await expect(publicDetail(listing.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
  });

  it("EXPIRED can never reactivate for free", async () => {
    const listing = await insertListing({ status: "EXPIRED", expiresOffsetMin: -60, deactivated: true });
    const row = await listingRow(listing.id);
    const result = await reactivateListing(auth(), listing.id, row.revision);
    expect(result.outcome).toBe("RENEWAL_REQUIRED");
    const after = await listingRow(listing.id);
    expect(after.seller_deactivated_at).not.toBeNull();
    expect(after.status).toBe("EXPIRED");
    // time-expired-but-still-ACTIVE behaves identically (job lag safety)
    const lagging = await insertListing({ status: "ACTIVE", expiresOffsetMin: -5, deactivated: true });
    const r2 = await reactivateListing(auth(), lagging.id, (await listingRow(lagging.id)).revision);
    expect(r2.outcome).toBe("RENEWAL_REQUIRED");
  });

  it("SUSPENDED and SOLD are refused; DELETED is not found; the finalizer is gate-complete", async () => {
    const suspended = await insertListing({ status: "SUSPENDED", deactivated: true });
    await expect(reactivateListing(auth(), suspended.id, 1)).rejects.toMatchObject({
      code: "LISTING_LIFECYCLE_CONFLICT",
    });
    const sold = await insertListing({ status: "SOLD", deactivated: true });
    await expect(reactivateListing(auth(), sold.id, 1)).rejects.toMatchObject({
      code: "LISTING_LIFECYCLE_CONFLICT",
    });
    const deleted = await insertListing({ status: "DELETED", deactivated: true });
    await expect(reactivateListing(auth(), deleted.id, 1)).rejects.toMatchObject({
      code: "LISTING_NOT_FOUND",
    });

    // finalizer alone (future approval/renewal callers) refuses without a request
    const plain = await insertListing({ deactivated: true });
    const res = await withTransaction((tx) => tryFinalizeSellerReactivationById(tx, plain.id));
    expect(res).toEqual({ finalized: false, reason: "NOT_REQUESTED" });
    expect((await listingRow(plain.id)).seller_deactivated_at).not.toBeNull();
  });
});

describe("expiry and promotions while deactivated", () => {
  it("the expiry job expires a deactivated listing normally; the flag survives", async () => {
    const listing = await insertListing({ deactivated: true, expiresOffsetMin: -10 });
    await withTransaction((tx) => expireListingsBatch(tx, 500));
    const row = await listingRow(listing.id);
    expect(row.status).toBe("EXPIRED"); // no validity pause
    expect(row.seller_deactivated_at).not.toBeNull(); // no automatic reactivation
  });

  it("promotion exposure stops and returns with visibility; promotion rows never change", async () => {
    const listing = await insertListing({});
    await promote(listing.id, "PREMIUM");
    const sql = getSql();
    const promoBefore = await sql<{ starts_at: Date; ends_at: Date }[]>`
      select starts_at, ends_at from listing_promotions where listing_id = ${listing.id}
    `;
    const inPremium = async () =>
      (await homeData()).home.premium.items.map((i) => Number(i.publicId)).includes(listing.publicId);
    expect(await inPremium()).toBe(true);

    await deactivateListing(auth(), listing.id, (await listingRow(listing.id)).revision);
    expect(await inPremium()).toBe(false);

    await reactivateListing(auth(), listing.id, (await listingRow(listing.id)).revision);
    expect(await inPremium()).toBe(true);

    const promoAfter = await sql<{ starts_at: Date; ends_at: Date }[]>`
      select starts_at, ends_at from listing_promotions where listing_id = ${listing.id}
    `;
    expect(promoAfter[0].starts_at.getTime()).toBe(promoBefore[0].starts_at.getTime());
    expect(promoAfter[0].ends_at.getTime()).toBe(promoBefore[0].ends_at.getTime());

    // shared-DB hygiene: this file must not leave a VISIBLE premium
    // listing behind for the marketplace suite's exact-set premium
    // assertions — hide it again through the real lifecycle service
    await deactivateListing(auth(), listing.id, (await listingRow(listing.id)).revision);
  });
});

describe("concurrency (no sleeps — DB primitives are the arbiter)", () => {
  it("two concurrent create-or-get calls converge on exactly one open revision", async () => {
    const listing = await insertListing({});
    const [a, b] = await Promise.all([
      getOrCreateEditRevision(auth(), listing.id),
      getOrCreateEditRevision(auth(), listing.id),
    ]);
    expect(a.id).toBe(b.id);
    const sql = getSql();
    const open = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_edit_revisions
      where listing_id = ${listing.id}
        and status in ('EDIT_DRAFT', 'PENDING_MODERATION', 'CORRECTION_REQUIRED')
    `;
    expect(Number(open[0].n)).toBe(1);
  });

  it("concurrent direct reactivations serialize to one consistent visible state", async () => {
    const listing = await insertListing({ deactivated: true });
    const row = await listingRow(listing.id);
    const results = await Promise.allSettled([
      reactivateListing(auth(), listing.id, row.revision),
      reactivateListing(auth(), listing.id, row.revision),
    ]);
    // one wins; the loser either sees the idempotent already-visible
    // path or a typed revision conflict — never a corrupt state
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      if (r.status === "rejected") {
        expect((r.reason as { code: string }).code).toBe("LISTING_REVISION_CONFLICT");
      }
    }
    const after = await listingRow(listing.id);
    expect(after.seller_deactivated_at).toBeNull();
    expect(after.seller_reactivation_requested_at).toBeNull();
  });

  it("deactivate vs reactivate serialize on the row lock into a consistent final state", async () => {
    const listing = await insertListing({ deactivated: true });
    const row = await listingRow(listing.id);
    const results = await Promise.allSettled([
      reactivateListing(auth(), listing.id, row.revision),
      deactivateListing(auth(), listing.id, row.revision + 1),
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        expect(["LISTING_REVISION_CONFLICT", "LISTING_LIFECYCLE_CONFLICT"]).toContain(
          (r.reason as { code: string }).code,
        );
      }
    }
    const after = await listingRow(listing.id);
    // whichever order the lock produced, the state is one of the two
    // legal outcomes and the intent flags are consistent with it
    if (after.seller_deactivated_at === null) {
      expect(after.seller_reactivation_requested_at).toBeNull();
    } else {
      expect(after.status).toBe("ACTIVE");
    }
  });

  it("finalizer-by-id under a locked listing row stays gate-complete against status changes", async () => {
    const listing = await insertListing({ deactivated: true });
    const sql = getSql();
    await sql`update listings set seller_reactivation_requested_at = now() where id = ${listing.id}`;
    await sql`update listings set status = 'EXPIRED', current_expires_at = now() - interval '1 minute' where id = ${listing.id}`;
    const res = await withTransaction((tx) => tryFinalizeSellerReactivationById(tx, listing.id));
    expect(res.finalized).toBe(false);
    expect(res.reason).toBe("EXPIRED");
    expect((await listingRow(listing.id)).seller_deactivated_at).not.toBeNull();
  });
});

describe("snapshot builder purity", () => {
  it("buildEditSnapshot maps the draft-PATCH field space exactly", async () => {
    const listing = await insertListing({});
    const row = await withTransaction((tx) => lockListingForLifecycle(tx, listing.id));
    const snap = buildEditSnapshot(row!, [featA]);
    expect(Object.keys(snap).sort()).toEqual(
      [
        "category",
        "brand_id",
        "model_id",
        "model_variant_id",
        "year",
        "price_minor",
        "mileage",
        "engine_cc",
        "fuel_type_id",
        "transmission_id",
        "body_type_id",
        "drive_type_id",
        "motorcycle_type_id",
        "color_id",
        "city_id",
        "credit_available",
        "barter_available",
        "no_accident",
        "not_repainted",
        "description",
        "contact_phone",
        "seller_name",
        "feature_ids",
      ].sort(),
    );
  });
});
