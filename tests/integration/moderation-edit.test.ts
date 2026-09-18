import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  createMemoryStorageProvider,
  type MemoryStorageProvider,
} from "@/providers/storage/memory-provider";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import { listingImageConfig } from "@/lib/config/listing-images";
import { publicDetail } from "@/services/marketplace";
import { myListings } from "@/services/my-listings";
import type { AuthContext } from "@/auth/current-user";
import { createTestUserSession } from "./helpers/session";
import { api, makeJpeg, type Route } from "./helpers/listing";
import {
  GET as editViewRoute,
  PATCH as editPatchRoute,
  POST as editCreateRoute,
} from "@/app/api/v1/me/listings/[listingId]/edit-revision/route";
import { POST as editSubmitRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/submit/route";
import { POST as editUploadUrlRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/images/upload-url/route";
import { POST as editConfirmRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/images/confirm/route";
import { DELETE as editDeleteImageRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/images/[imageId]/route";
import { GET as queueRoute } from "@/app/api/v1/moderator/listings/route";
import { GET as detailRoute } from "@/app/api/v1/moderator/listings/[listingId]/route";
import { POST as claimRoute } from "@/app/api/v1/moderator/listings/[listingId]/claim/route";
import { POST as editApproveRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/approve/route";
import { POST as editRejectRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/reject/route";
import { POST as editCorrectionRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/request-correction/route";

/**
 * O.12 Stage D — moderator edit review + decisions. RELEASE-BLOCKING
 * invariants: approval is a pure content swap (no period, no fee, no
 * status/publication/expiry change, same publicId); visibility flags
 * are cleared ONLY through the central finalizer; correction preserves
 * and rejection clears the reactivation intent.
 */

const SELLER_BASE = "http://localhost/api/v1/me/listings";
const MOD = "http://localhost/api/v1/moderator/listings";

let storage: MemoryStorageProvider;
let carCat: string;
let brand: string;
let model: string;
let city: string;
let featA: string;
let featB: string;
let phoneCounter = 6_100_000;
type Session = { userId: string; cookie: string };
let seller: Session;
let moderator: Session;
let moderator2: Session;

/** Fixed far-past submission clock: Stage D fixtures always sort FIRST
    in the shared-DB queue, making first-page assertions deterministic. */
let submitClock = Date.parse("2000-01-01T00:00:00Z");
function nextSubmittedAt(): Date {
  submitClock += 60_000;
  return new Date(submitClock);
}

async function newUser(opts: { blocked?: boolean; roles?: string[] } = {}): Promise<Session> {
  phoneCounter += 1;
  return createTestUserSession(`+99451${phoneCounter}`, opts);
}

const sellerAuth = (): AuthContext => ({ user: { id: seller.userId } }) as AuthContext;

async function insertActiveListing(spec: {
  deactivated?: boolean;
  requested?: boolean;
  status?: string;
  expiresOffsetMin?: number;
  features?: string[];
}): Promise<{ id: string; publicId: number; imagePaths: string[] }> {
  const sql = getSql();
  const [row] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
      mileage, credit_available, barter_available, description, contact_phone_e164, seller_name,
      status, submitted_at, published_at, current_expires_at,
      seller_deactivated_at, seller_reactivation_requested_at)
    values (${seller.userId}, ${carCat}, ${brand}, ${model}, ${city}, 2021, 2000000,
      50000, false, false, 'MdE əvvəlki təsvir', '+994501234567', 'MdE Satıcı',
      ${spec.status ?? "ACTIVE"}::listing_status, now() - interval '4 days',
      now() - interval '3 days',
      now() + (${spec.expiresOffsetMin ?? 60 * 24 * 15} || ' minutes')::interval,
      ${spec.deactivated === true ? sql`now()` : null},
      ${spec.requested === true ? sql`now()` : null})
    returning id, public_id::text as public_id
  `;
  const imagePaths: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const path = `listings/${randomUUID()}.webp`;
    imagePaths.push(path);
    storage.objects.set(`${listingImageConfig().imagesBucket}/${path}`, {
      data: Buffer.from("approved"),
      contentType: "image/webp",
    });
    await sql`
      insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${row.id}, ${path}, ${i}, ${i === 0}, 'image/webp', 1000, 1600, 900)
    `;
  }
  for (const f of spec.features ?? [featA]) {
    await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${f})`;
  }
  return { id: row.id, publicId: Number(row.public_id), imagePaths };
}

const eb = (id: string): string => `${SELLER_BASE}/${id}/edit-revision`;

/** Real seller flow: create-or-get, apply changes, submit — then pin
    the revision's submitted_at onto the deterministic far-past clock. */
async function submitEdit(
  listingId: string,
  changes: Record<string, unknown>,
  options: { activate?: boolean } = {},
): Promise<{ revisionId: string; revisionNo: number }> {
  const create = await api(editCreateRoute as Route, "POST", eb(listingId), {
    cookie: seller.cookie,
    params: { listingId },
  });
  expect(create.status).toBe(200);
  let no = (create.body.data?.listing as { revision: number }).revision;
  if (Object.keys(changes).length > 0) {
    const patch = await api(editPatchRoute as Route, "PATCH", eb(listingId), {
      body: { expected_revision: no, ...changes },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(patch.status).toBe(200);
    no = (patch.body.data?.listing as { revision: number }).revision;
  }
  const submit = await api(editSubmitRoute as Route, "POST", `${eb(listingId)}/submit`, {
    body: options.activate === true ? { expected_revision: no, activate: true } : { expected_revision: no },
    cookie: seller.cookie,
    params: { listingId },
  });
  expect(submit.status).toBe(200);
  const revisionId = submit.body.data?.editRevisionId as string;
  const sql = getSql();
  await sql`update listing_edit_revisions set submitted_at = ${nextSubmittedAt()} where id = ${revisionId}`;
  return { revisionId, revisionNo: submit.body.data?.editRevision as number };
}

async function claim(mod: Session, listingId: string) {
  return api(claimRoute as Route, "POST", `${MOD}/${listingId}/claim`, {
    cookie: mod.cookie,
    params: { listingId },
  });
}
async function approveEdit(mod: Session, listingId: string, no: number) {
  return api(editApproveRoute as Route, "POST", `${MOD}/${listingId}/edit/approve`, {
    body: { expected_edit_revision: no },
    cookie: mod.cookie,
    params: { listingId },
  });
}
async function rejectEdit(mod: Session, listingId: string, no: number) {
  return api(editRejectRoute as Route, "POST", `${MOD}/${listingId}/edit/reject`, {
    body: { expected_edit_revision: no, reason_code: "MISLEADING_INFO", note: "yalnış" },
    cookie: mod.cookie,
    params: { listingId },
  });
}
async function correctionEdit(mod: Session, listingId: string, no: number) {
  return api(editCorrectionRoute as Route, "POST", `${MOD}/${listingId}/edit/request-correction`, {
    body: { expected_edit_revision: no, reason_code: "INVALID_PHOTOS", note: "şəkilləri düzəldin" },
    cookie: mod.cookie,
    params: { listingId },
  });
}

async function listingSnapshot(id: string): Promise<{
  status: string;
  price: string;
  expires: number | null;
  published: number | null;
  deactivated: boolean;
  requested: boolean;
  publicId: string;
  features: string[];
  imagePaths: string[];
  periods: number;
  payments: number;
  publications: number;
}> {
  const sql = getSql();
  const [row] = await sql<
    {
      status: string;
      price_minor: string;
      current_expires_at: Date | null;
      published_at: Date | null;
      seller_deactivated_at: Date | null;
      seller_reactivation_requested_at: Date | null;
      public_id: string;
    }[]
  >`select status, price_minor::text as price_minor, current_expires_at, published_at,
      seller_deactivated_at, seller_reactivation_requested_at, public_id::text as public_id
    from listings where id = ${id}`;
  const features = await sql<{ feature_id: string }[]>`
    select feature_id from listing_features where listing_id = ${id} order by feature_id`;
  const images = await sql<{ storage_path: string }[]>`
    select storage_path from listing_images where listing_id = ${id} order by sort_order`;
  const [{ n: periods }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_periods where listing_id = ${id}`;
  const [{ n: payments }] = await sql<{ n: string }[]>`
    select count(*)::text as n from payments where listing_id = ${id}`;
  const [{ n: publications }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_publications where listing_id = ${id}`;
  return {
    status: row.status,
    price: row.price_minor,
    expires: row.current_expires_at?.getTime() ?? null,
    published: row.published_at?.getTime() ?? null,
    deactivated: row.seller_deactivated_at !== null,
    requested: row.seller_reactivation_requested_at !== null,
    publicId: row.public_id,
    features: features.map((f) => f.feature_id),
    imagePaths: images.map((i) => i.storage_path),
    periods: Number(periods),
    payments: Number(payments),
    publications: Number(publications),
  };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  seller = await newUser();
  moderator = await newUser({ roles: ["MODERATOR"] });
  moderator2 = await newUser({ roles: ["MODERATOR"] });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('MdEBrand', 'mde-brand') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  model = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'MdEModel', 'mde-model') returning id`)[0].id;
  city = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('MdEŞəhər', 'mde-seher', 95) returning id`)[0].id;
  featA = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('MDE_FEAT_A', 'MdE Avadanlıq A', 'SAFETY') returning id`)[0].id;
  featB = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('MDE_FEAT_B', 'MdE Avadanlıq B', 'COMFORT') returning id`)[0].id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("queue union + claim", () => {
  it("merges NEW_LISTING and LISTING_EDIT deterministically with types, cursors and no duplication", async () => {
    const sql = getSql();
    // NEW pending fixture pinned between two edit submissions
    const editFirst = await insertActiveListing({});
    const first = await submitEdit(editFirst.id, { price_minor: 2100000 });
    const [newRow] = await sql<{ id: string }[]>`
      insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
        mileage, credit_available, barter_available, description, contact_phone_e164, seller_name,
        status, submitted_at)
      values (${seller.userId}, ${carCat}, ${brand}, ${model}, ${city}, 2020, 900000, 10000,
        false, false, 'MdE yeni elan', '+994501234567', 'MdE Satıcı',
        'PENDING_MODERATION', ${nextSubmittedAt()})
      returning id
    `;
    const editSecond = await insertActiveListing({});
    const second = await submitEdit(editSecond.id, { price_minor: 2200000 });

    // page walk with limit=2: stable order, no dup, no starvation
    const seen: { id: string; type: string }[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6 && seen.length < 3; i += 1) {
      const url: string = `${MOD}?limit=2${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const page = await api(queueRoute as Route, "GET", url, { cookie: moderator.cookie });
      expect(page.status).toBe(200);
      const items = page.body.data?.items as { id: string; type: string }[];
      for (const item of items) {
        if ([editFirst.id, newRow.id, editSecond.id].includes(item.id)) {
          seen.push({ id: item.id, type: item.type });
        }
      }
      cursor = (page.body.data?.next_cursor as string | null) ?? null;
      if (cursor === null) break;
    }
    expect(seen).toEqual([
      { id: editFirst.id, type: "LISTING_EDIT" },
      { id: newRow.id, type: "NEW_LISTING" },
      { id: editSecond.id, type: "LISTING_EDIT" },
    ]);

    // claim reuse: same infrastructure serializes the edit review
    const claimed = await claim(moderator, editFirst.id);
    expect(claimed.status).toBe(200);
    const conflictClaim = await claim(moderator2, editFirst.id);
    expect(conflictClaim.status).toBe(409);
    expect(conflictClaim.body.error?.code).toBe("MODERATION_CLAIMED_BY_OTHER");
    // decision without a claim is refused for the other moderator
    const noClaim = await approveEdit(moderator2, editSecond.id, second.revisionNo);
    expect(noClaim.status).toBe(409);
    expect(noClaim.body.error?.code).toBe("MODERATION_CLAIM_REQUIRED");
    // sellers can never call edit decision endpoints
    const sellerTry = await approveEdit(seller, editFirst.id, first.revisionNo);
    expect(sellerTry.status).toBe(403);

    // detail carries the server-computed diff for the pending edit
    const detail = await api(detailRoute as Route, "GET", `${MOD}/${editFirst.id}`, {
      cookie: moderator.cookie,
      params: { listingId: editFirst.id },
    });
    expect(detail.status).toBe(200);
    const review = (detail.body.data?.listing as { editReview: {
      scalarChanges: { field: string; oldValue: string; newValue: string }[];
    } }).editReview;
    expect(review.scalarChanges).toEqual([
      { field: "price", oldValue: "20 000 AZN", newValue: "21 000 AZN" },
    ]);

    // cleanup: keep the shared queue small for later files
    await claim(moderator, editFirst.id);
    await approveEdit(moderator, editFirst.id, first.revisionNo);
    await claim(moderator, editSecond.id);
    await approveEdit(moderator, editSecond.id, second.revisionNo);
    await sql`update listings set status = 'REJECTED' where id = ${newRow.id}`;
  });
});

describe("diff accuracy", () => {
  it("reports exactly the changed fields — scalars, claims, equipment, photos, description", async () => {
    const fixture = await insertActiveListing({ features: [featA] });
    // seller changes: price, mileage, claim, description, equipment
    // swap A→B, one new photo, one removed photo, new primary
    const create = await api(editCreateRoute as Route, "POST", eb(fixture.id), {
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    let no = (create.body.data?.listing as { revision: number }).revision;
    const staged = (create.body.data?.listing as { images: { id: string }[] }).images;
    const patch = await api(editPatchRoute as Route, "PATCH", eb(fixture.id), {
      body: {
        expected_revision: no,
        price_minor: 1950000,
        mileage: 60000,
        no_accident: true,
        description: "MdE yeni təsvir",
        feature_ids: [featB],
        seller_name: "MdE Yeni Ad",
      },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(patch.status).toBe(200);
    no = (patch.body.data?.listing as { revision: number }).revision;
    // remove one staged (approved) image, add a new one
    const del = await api(editDeleteImageRoute as Route, "DELETE", `${eb(fixture.id)}/images/${staged[2].id}`, {
      cookie: seller.cookie,
      params: { listingId: fixture.id, imageId: staged[2].id },
    });
    expect(del.status).toBe(200);
    const auth = await api(editUploadUrlRoute as Route, "POST", `${eb(fixture.id)}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    storage.uploadViaSignedUrl(auth.body.data?.upload_url as string, await makeJpeg(), "image/jpeg");
    const confirm = await api(editConfirmRoute as Route, "POST", `${eb(fixture.id)}/images/confirm`, {
      body: { upload_id: auth.body.data?.upload_id },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(confirm.status).toBe(201);
    no = confirm.body.data?.revision as number;
    const submit = await api(editSubmitRoute as Route, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: no },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(submit.status).toBe(200);
    const sql = getSql();
    await sql`update listing_edit_revisions set submitted_at = ${nextSubmittedAt()}
      where id = ${submit.body.data?.editRevisionId as string}`;

    const detail = await api(detailRoute as Route, "GET", `${MOD}/${fixture.id}`, {
      cookie: moderator.cookie,
      params: { listingId: fixture.id },
    });
    const review = (detail.body.data?.listing as { editReview: {
      scalarChanges: { field: string; oldValue: string | null; newValue: string | null }[];
      descriptionChange: { before: string; after: string };
      equipmentAdded: string[];
      equipmentRemoved: string[];
      photoDiff: { badge: string | null }[];
      unchanged: { field: string }[];
    } }).editReview;
    const byField = new Map(review.scalarChanges.map((c) => [c.field, c]));
    expect(byField.get("price")).toEqual({ field: "price", oldValue: "20 000 AZN", newValue: "19 500 AZN" });
    expect(byField.get("mileage")).toEqual({ field: "mileage", oldValue: "50000 km", newValue: "60000 km" });
    expect(byField.get("no_accident")).toEqual({ field: "no_accident", oldValue: "Yox", newValue: "Bəli" });
    expect(byField.get("seller_name")).toEqual({ field: "seller_name", oldValue: "MdE Satıcı", newValue: "MdE Yeni Ad" });
    // unchanged values NEVER reported as changes
    expect(byField.has("brand")).toBe(false);
    expect(byField.has("model")).toBe(false);
    expect(byField.has("city")).toBe(false);
    expect(byField.has("contact_phone")).toBe(false);
    expect(review.unchanged.map((u) => u.field)).toContain("brand");
    expect(review.descriptionChange).toEqual({ before: "MdE əvvəlki təsvir", after: "MdE yeni təsvir" });
    expect(review.equipmentAdded).toEqual(["MdE Avadanlıq B"]);
    expect(review.equipmentRemoved).toEqual(["MdE Avadanlıq A"]);
    const badges = review.photoDiff.map((p) => p.badge);
    expect(badges.filter((b) => b === "ADDED")).toHaveLength(1);
    expect(badges.filter((b) => b === "REMOVED")).toHaveLength(1);
    // shared approved images are NEVER classified as added
    expect(badges.filter((b) => b === null).length).toBeGreaterThanOrEqual(1);
  });
});

describe("approve", () => {
  it("ACTIVE approve: full content swap, identity/expiry/commerce untouched, public switches", async () => {
    const fixture = await insertActiveListing({ features: [featA] });
    const before = await listingSnapshot(fixture.id);
    const edit = await submitEdit(fixture.id, {
      price_minor: 2350000,
      description: "MdE təsdiqlənəcək təsvir",
      feature_ids: [featA, featB],
    });
    // §58: before approval the OLD content is public
    let detail = await publicDetail(fixture.publicId);
    expect(detail.listing.priceMinor).toBe(2000000);

    await claim(moderator, fixture.id);
    const approved = await approveEdit(moderator, fixture.id, edit.revisionNo);
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({
      editRevision: { status: "APPROVED" },
      reactivated: false,
    });

    const after = await listingSnapshot(fixture.id);
    expect(after.price).toBe("2350000");
    expect(after.features).toEqual([featA, featB].sort());
    // §15/§22: identity + validity untouched, zero commerce
    expect(after.status).toBe("ACTIVE");
    expect(after.publicId).toBe(before.publicId);
    expect(after.expires).toBe(before.expires);
    expect(after.published).toBe(before.published);
    expect(after.periods).toBe(before.periods);
    expect(after.payments).toBe(before.payments);
    expect(after.publications).toBe(before.publications);
    // gallery unchanged here (no photo edits) — same paths
    expect(after.imagePaths).toEqual(before.imagePaths);

    // §58: after approval the NEW content is public
    detail = await publicDetail(fixture.publicId);
    expect(detail.listing.priceMinor).toBe(2350000);

    // revision history retained as APPROVED with decided_at
    const sql = getSql();
    const [rev] = await sql<{ status: string; decided_at: Date | null }[]>`
      select status, decided_at from listing_edit_revisions where id = ${edit.revisionId}`;
    expect(rev.status).toBe("APPROVED");
    expect(rev.decided_at).not.toBeNull();
    // review row records BOTH counters
    const [reviewRow] = await sql<
      { listing_revision: number; edit_revision_id: string; edit_revision_no: number }[]
    >`select listing_revision, edit_revision_id, edit_revision_no from moderation_reviews
      where edit_revision_id = ${edit.revisionId}`;
    expect(reviewRow.edit_revision_no).toBe(edit.revisionNo);
    expect(reviewRow.listing_revision).toBeGreaterThan(0);

    // idempotent retry: same decision, no duplicated effects
    await claim(moderator, fixture.id).catch(() => undefined);
    const retry = await approveEdit(moderator, fixture.id, edit.revisionNo);
    expect(retry.status).toBe(200);
    const [{ n: reviewCount }] = await sql<{ n: string }[]>`
      select count(*)::text as n from moderation_reviews where edit_revision_id = ${edit.revisionId}`;
    expect(Number(reviewCount)).toBe(1);
    expect((await listingSnapshot(fixture.id)).periods).toBe(before.periods);

    // §59: seller read-model — pending chip data gone, fresh edit offered
    const card = (await myListings(sellerAuth(), "all")).find((c) => c.id === fixture.id)!;
    expect(card.management.editStatus).toBe("APPROVED");
    expect(card.management.editAction).toBe("EDIT");
    expect(card.management.primary).toBe("ACTIVE");
  });

  it("approve swaps the gallery atomically and never deletes storage objects", async () => {
    const fixture = await insertActiveListing({});
    const create = await api(editCreateRoute as Route, "POST", eb(fixture.id), {
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    const staged = (create.body.data?.listing as { images: { id: string }[]; revision: number });
    // remove first approved-snapshot image, add a new one
    await api(editDeleteImageRoute as Route, "DELETE", `${eb(fixture.id)}/images/${staged.images[0].id}`, {
      cookie: seller.cookie,
      params: { listingId: fixture.id, imageId: staged.images[0].id },
    });
    const auth = await api(editUploadUrlRoute as Route, "POST", `${eb(fixture.id)}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    storage.uploadViaSignedUrl(auth.body.data?.upload_url as string, await makeJpeg(), "image/jpeg");
    const confirm = await api(editConfirmRoute as Route, "POST", `${eb(fixture.id)}/images/confirm`, {
      body: { upload_id: auth.body.data?.upload_id },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    const no = confirm.body.data?.revision as number;
    const submit = await api(editSubmitRoute as Route, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: no },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(submit.status).toBe(200);
    const revisionId = submit.body.data?.editRevisionId as string;
    const sql = getSql();
    await sql`update listing_edit_revisions set submitted_at = ${nextSubmittedAt()} where id = ${revisionId}`;

    const stagedRows = await sql<{ storage_path: string; sort_order: number; is_primary: boolean }[]>`
      select storage_path, sort_order, is_primary from listing_edit_images
      where edit_revision_id = ${revisionId} order by sort_order`;

    await claim(moderator, fixture.id);
    const approved = await approveEdit(moderator, fixture.id, no);
    expect(approved.status).toBe(200);

    const after = await sql<{ storage_path: string; sort_order: number; is_primary: boolean }[]>`
      select storage_path, sort_order, is_primary from listing_images
      where listing_id = ${fixture.id} order by sort_order`;
    // same order, primary and set as staged — exactly one primary
    expect(after.map((r) => r.storage_path)).toEqual(stagedRows.map((r) => r.storage_path));
    expect(after.filter((r) => r.is_primary)).toHaveLength(1);
    expect(after.map((r) => r.is_primary)).toEqual(stagedRows.map((r) => r.is_primary));
    // the replaced approved object still exists in storage (candidate only)
    expect(storage.has(listingImageConfig().imagesBucket, fixture.imagePaths[0])).toBe(true);
    const events = await sql<{ payload: { cleanup_candidate_paths?: string } }[]>`
      select payload from outbox_events
      where event_type = 'LISTING_EDIT_APPROVED' and aggregate_id = ${fixture.id}`;
    expect(events[0].payload.cleanup_candidate_paths).toBe(fixture.imagePaths[0]);
    // staged history rows retained
    const [{ n }] = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_edit_images where edit_revision_id = ${revisionId}`;
    expect(Number(n)).toBe(3);
  });

  it("RELEASE-BLOCKING: deactivated without a request stays hidden after approval", async () => {
    const fixture = await insertActiveListing({ deactivated: true });
    const edit = await submitEdit(fixture.id, { price_minor: 2400000 });
    await claim(moderator, fixture.id);
    const approved = await approveEdit(moderator, fixture.id, edit.revisionNo);
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ reactivated: false });
    const after = await listingSnapshot(fixture.id);
    expect(after.price).toBe("2400000"); // content updated
    expect(after.deactivated).toBe(true); // still hidden — finalizer refused
    await expect(publicDetail(fixture.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
  });

  it("deactivated + requested + time-valid: approval reactivates through the finalizer only", async () => {
    const fixture = await insertActiveListing({ deactivated: true, requested: true });
    const edit = await submitEdit(fixture.id, { price_minor: 2450000 });
    const before = await listingSnapshot(fixture.id);
    await claim(moderator, fixture.id);
    const approved = await approveEdit(moderator, fixture.id, edit.revisionNo);
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ reactivated: true });
    const after = await listingSnapshot(fixture.id);
    expect(after.deactivated).toBe(false);
    expect(after.requested).toBe(false);
    expect(after.periods).toBe(before.periods); // no new period
    expect(after.expires).toBe(before.expires);
    const detail = await publicDetail(fixture.publicId);
    expect(detail.listing.priceMinor).toBe(2450000); // new content live
    // §59: card back to Aktiv
    const card = (await myListings(sellerAuth(), "all")).find((c) => c.id === fixture.id)!;
    expect(card.management.primary).toBe("ACTIVE");
  });

  it("EXPIRED approve: content approved, listing stays EXPIRED, renewal is next", async () => {
    const fixture = await insertActiveListing({ status: "EXPIRED", expiresOffsetMin: -120 });
    const edit = await submitEdit(fixture.id, { price_minor: 2500000 });
    const before = await listingSnapshot(fixture.id);
    await claim(moderator, fixture.id);
    const approved = await approveEdit(moderator, fixture.id, edit.revisionNo);
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ reactivated: false });
    const after = await listingSnapshot(fixture.id);
    expect(after.status).toBe("EXPIRED");
    expect(after.expires).toBe(before.expires);
    expect(after.periods).toBe(before.periods);
    expect(after.payments).toBe(before.payments);
    expect(after.price).toBe("2500000");
    // §26/§59: Müddəti bitib + Dəyişiklik təsdiqlənib + combined renewal
    const card = (await myListings(sellerAuth(), "all")).find((c) => c.id === fixture.id)!;
    expect(card.management.primary).toBe("EXPIRED");
    expect(card.management.editStatus).toBe("APPROVED");
    expect(card.management.renewal).toBe("RENEW_ACTIVATE");
  });

  it("RELEASE-BLOCKING: expiry before approval keeps it private, request survives, no free period", async () => {
    const fixture = await insertActiveListing({ deactivated: true, requested: true });
    const edit = await submitEdit(fixture.id, { price_minor: 2600000 });
    // the clock beats the moderator: time-valid → expired (job may lag)
    const sql = getSql();
    await sql`update listings set current_expires_at = now() - interval '1 hour' where id = ${fixture.id}`;
    await claim(moderator, fixture.id);
    const approved = await approveEdit(moderator, fixture.id, edit.revisionNo);
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ reactivated: false });
    const after = await listingSnapshot(fixture.id);
    expect(after.price).toBe("2600000"); // content approved
    expect(after.deactivated).toBe(true); // finalizer time gate refused
    expect(after.requested).toBe(true); // intent survives for Stage E renewal
    expect(after.periods).toBe(0); // never a free publication
    await expect(publicDetail(fixture.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
  });

  it("stale edit_revision_no decisions are refused; claim is mandatory", async () => {
    const fixture = await insertActiveListing({});
    const edit = await submitEdit(fixture.id, { price_minor: 2700000 });
    await claim(moderator, fixture.id);
    const stale = await approveEdit(moderator, fixture.id, edit.revisionNo - 1 || 999);
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("LISTING_REVISION_CONFLICT");
    // the listing content was NOT touched by the refused decision
    expect((await listingSnapshot(fixture.id)).price).toBe("2000000");
    // clean up: decide it properly so the queue stays small
    const done = await approveEdit(moderator, fixture.id, edit.revisionNo);
    expect(done.status).toBe(200);
  });
});

describe("correction", () => {
  it("hands the SAME revision back, preserves the activation intent, resubmit re-queues", async () => {
    const fixture = await insertActiveListing({ deactivated: true, requested: true });
    const edit = await submitEdit(fixture.id, { price_minor: 2800000 });
    const before = await listingSnapshot(fixture.id);
    await claim(moderator, fixture.id);
    const corrected = await correctionEdit(moderator, fixture.id, edit.revisionNo);
    expect(corrected.status).toBe(200);
    expect(corrected.body.data).toMatchObject({
      editRevision: { id: edit.revisionId, status: "CORRECTION_REQUIRED" },
      reactivated: false,
    });

    // §27: listing + public content untouched; request PRESERVED
    const after = await listingSnapshot(fixture.id);
    expect(after.price).toBe(before.price);
    expect(after.deactivated).toBe(true);
    expect(after.requested).toBe(true);

    // Stage C seller flow consumes the REAL decision: feedback + same
    // revision editable + resubmit without a second revision
    const view = await api(editViewRoute as Route, "GET", eb(fixture.id), {
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(view.status).toBe(200);
    expect((view.body.data?.context as { editStatus: string }).editStatus).toBe("CORRECTION_REQUIRED");
    expect((view.body.data?.context as { moderationFeedback: { reasonCode: string; note: string } }).moderationFeedback)
      .toEqual({ reasonCode: "INVALID_PHOTOS", note: "şəkilləri düzəldin" });
    const no = (view.body.data?.listing as { revision: number }).revision;
    const patch = await api(editPatchRoute as Route, "PATCH", eb(fixture.id), {
      body: { expected_revision: no, description: "MdE düzəldilmiş" },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(patch.status).toBe(200);
    const resubmit = await api(editSubmitRoute as Route, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: no + 1 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data).toMatchObject({ editRevisionId: edit.revisionId }); // same revision
    const sql = getSql();
    const [{ n }] = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_edit_revisions where listing_id = ${fixture.id}`;
    expect(Number(n)).toBe(1);
    // queue receives it again as LISTING_EDIT
    await sql`update listing_edit_revisions set submitted_at = ${nextSubmittedAt()} where id = ${edit.revisionId}`;
    const page = await api(queueRoute as Route, "GET", `${MOD}?limit=100`, { cookie: moderator.cookie });
    const item = (page.body.data?.items as { id: string; type: string }[]).find((i) => i.id === fixture.id);
    expect(item?.type).toBe("LISTING_EDIT");
    // cleanup: approve to keep the shared queue small
    await claim(moderator, fixture.id);
    await approveEdit(moderator, fixture.id, no + 1);
  });
});

describe("reject", () => {
  it("terminal REJECTED: old content stays public, intent cleared, fresh edit allowed", async () => {
    const fixture = await insertActiveListing({ deactivated: true, requested: true });
    const edit = await submitEdit(fixture.id, { price_minor: 2900000 });
    await claim(moderator, fixture.id);
    const rejected = await rejectEdit(moderator, fixture.id, edit.revisionNo);
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      editRevision: { status: "REJECTED" },
      reactivated: false,
    });
    const after = await listingSnapshot(fixture.id);
    expect(after.price).toBe("2000000"); // approved content unchanged
    expect(after.status).toBe("ACTIVE"); // never listing.status REJECTED
    expect(after.deactivated).toBe(true); // visibility unchanged
    expect(after.requested).toBe(false); // §28: stale intent CLEARED

    // §59/§37: card back to plain Deaktiv, fresh edit permitted
    const card = (await myListings(sellerAuth(), "all")).find((c) => c.id === fixture.id)!;
    expect(card.editRevision).toBeNull();
    expect(card.management.primary).toBe("DEACTIVATED");
    expect(card.management.editAction).toBe("EDIT");
    const fresh = await api(editCreateRoute as Route, "POST", eb(fixture.id), {
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(fresh.status).toBe(200);
    const freshId = (fresh.body.data?.context as { editRevisionId: string }).editRevisionId;
    expect(freshId).not.toBe(edit.revisionId);
    // rejected revision retained as history
    const sql = getSql();
    const [rev] = await sql<{ status: string }[]>`
      select status from listing_edit_revisions where id = ${edit.revisionId}`;
    expect(rev.status).toBe("REJECTED");
  });

  it("REJECTED edit on a public ACTIVE listing leaves it live with old data", async () => {
    const fixture = await insertActiveListing({});
    const edit = await submitEdit(fixture.id, { description: "MdE rədd olunacaq" });
    await claim(moderator, fixture.id);
    await rejectEdit(moderator, fixture.id, edit.revisionNo);
    const detail = await publicDetail(fixture.publicId);
    expect(detail.listing.status).toBe("ACTIVE");
    expect(detail.listing.priceMinor).toBe(2000000);
    const card = (await myListings(sellerAuth(), "all")).find((c) => c.id === fixture.id)!;
    expect(card.management.primary).toBe("ACTIVE");
  });
});
