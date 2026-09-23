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
import { runImageCleanup } from "@/services/lifecycle-jobs";
import { createTestUserSession } from "./helpers/session";
import { api, type Route } from "./helpers/listing";
import {
  PATCH as editPatchRoute,
  POST as editCreateRoute,
} from "@/app/api/v1/me/listings/[listingId]/edit-revision/route";
import { POST as editSubmitRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/submit/route";
import { DELETE as editDeleteImageRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/images/[imageId]/route";
import { POST as claimRoute } from "@/app/api/v1/moderator/listings/[listingId]/claim/route";
import { POST as editApproveRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/approve/route";
import { POST as editRejectRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/reject/route";
import { POST as editCorrectionRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/request-correction/route";
import { PUT as adjustmentSaveRoute } from "@/app/api/v1/moderator/listings/[listingId]/adjustment/route";

/**
 * O.13 Stage D — moderator-adjusted LISTING_EDIT decisions.
 * RELEASE-BLOCKING invariants: adjusted approval applies the saved
 * moderator content atomically as a pure CONTENT swap (no period, no
 * fee, no quota, no expiry change — O.12 sealed); the seller proposal
 * (revision.data + staged listing_edit_images) survives untouched; the
 * old public content stays live until approval; correction/reject
 * apply nothing and terminal-discard; the central finalizer remains
 * the sole reactivation-visibility writer.
 */

const SELLER_BASE = "http://localhost/api/v1/me/listings";
const MOD = "http://localhost/api/v1/moderator/listings";
const CONTACT = "+994701117777";
const BUCKET = () => listingImageConfig().imagesBucket;

let storage: MemoryStorageProvider;
let carCat: string;
let brand: string;
let model: string;
let city: string;
let featA: string;
let featB: string;
let phoneCounter = 6_700_000;
type Session = { userId: string; cookie: string };
let seller: Session;
let mod1: Session;

async function newUser(opts: { roles?: string[] } = {}): Promise<Session> {
  phoneCounter += 1;
  return createTestUserSession(`+99451${phoneCounter}`, opts);
}

async function insertActiveListing(spec: {
  deactivated?: boolean;
  requested?: boolean;
  status?: string;
  expiresOffsetMin?: number;
  images?: number;
} = {}): Promise<{ id: string; publicId: number; revision: number; imagePaths: string[] }> {
  const sql = getSql();
  const [row] = await sql<{ id: string; public_id: string; revision: number }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
      mileage, credit_available, barter_available, description, contact_phone_e164, seller_name,
      status, submitted_at, published_at, current_expires_at,
      seller_deactivated_at, seller_reactivation_requested_at)
    values (${seller.userId}, ${carCat}, ${brand}, ${model}, ${city}, 2021, 2500000,
      50000, false, false, 'O13D əvvəlki təsvir', ${CONTACT}, 'O13D Satıcı',
      ${spec.status ?? "ACTIVE"}::listing_status, now() - interval '4 days',
      now() - interval '3 days',
      now() + (${spec.expiresOffsetMin ?? 60 * 24 * 15} || ' minutes')::interval,
      ${spec.deactivated === true ? sql`now()` : null},
      ${spec.requested === true ? sql`now()` : null})
    returning id, public_id::text as public_id, revision
  `;
  const imagePaths: string[] = [];
  for (let i = 0; i < (spec.images ?? 4); i += 1) {
    const path = `listings/${randomUUID()}.webp`;
    imagePaths.push(path);
    storage.objects.set(`${BUCKET()}/${path}`, {
      data: Buffer.from("img"),
      contentType: "image/webp",
    });
    await sql`
      insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${row.id}, ${path}, ${i}, ${i === 0}, 'image/webp', 1000, 1600, 900)
    `;
  }
  await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${featA})`;
  return { id: row.id, publicId: Number(row.public_id), revision: row.revision, imagePaths };
}

const eb = (id: string): string => `${SELLER_BASE}/${id}/edit-revision`;

async function submitEdit(
  listingId: string,
  changes: Record<string, unknown>,
  options: { dropFirstStagedImage?: boolean } = {},
): Promise<{ revisionId: string; revisionNo: number; stagedIds: string[] }> {
  const create = await api(editCreateRoute as Route, "POST", eb(listingId), {
    cookie: seller.cookie,
    params: { listingId },
  });
  expect(create.status).toBe(200);
  let no = (create.body.data?.listing as { revision: number }).revision;
  if (options.dropFirstStagedImage === true) {
    const [first] = await getSql()<{ id: string }[]>`
      select lei.id from listing_edit_images lei
      join listing_edit_revisions ler on ler.id = lei.edit_revision_id
      where ler.listing_id = ${listingId} order by lei.sort_order limit 1
    `;
    const del = await api(
      editDeleteImageRoute as Route,
      "DELETE",
      `${eb(listingId)}/images/${first.id}`,
      { cookie: seller.cookie, params: { listingId, imageId: first.id } },
    );
    expect(del.status).toBe(200);
    no = (
      await getSql()<{ revision: number }[]>`
        select revision from listing_edit_revisions where listing_id = ${listingId}
      `
    )[0].revision;
  }
  const patch = await api(editPatchRoute as Route, "PATCH", eb(listingId), {
    body: { expected_revision: no, ...changes },
    cookie: seller.cookie,
    params: { listingId },
  });
  expect(patch.status).toBe(200);
  no = (patch.body.data?.listing as { revision: number }).revision;
  const submit = await api(editSubmitRoute as Route, "POST", `${eb(listingId)}/submit`, {
    body: { expected_revision: no },
    cookie: seller.cookie,
    params: { listingId },
  });
  expect(submit.status).toBe(200);
  const revisionId = submit.body.data?.editRevisionId as string;
  const staged = await getSql()<{ id: string }[]>`
    select id from listing_edit_images where edit_revision_id = ${revisionId} order by sort_order
  `;
  return {
    revisionId,
    revisionNo: submit.body.data?.editRevision as number,
    stagedIds: staged.map((row) => row.id),
  };
}

async function claim(session: Session, listingId: string) {
  return api(claimRoute as Route, "POST", `${MOD}/${listingId}/claim`, {
    cookie: session.cookie,
    params: { listingId },
  });
}

function planFor(
  imageIds: string[],
  overrides: Partial<Record<number, { removed?: boolean; primary?: boolean }>> = {},
) {
  return imageIds.map((id, index) => ({
    source_id: id,
    removed: overrides[index]?.removed ?? false,
    is_primary: overrides[index]?.primary ?? index === 0,
  }));
}

async function saveAdjustment(
  listingId: string,
  edit: { revisionId: string; revisionNo: number },
  listingRevision: number,
  content: Record<string, unknown>,
  imagePlan: unknown[],
  expectedAdjustmentRevision: number | null = null,
) {
  return api(adjustmentSaveRoute as Route, "PUT", `${MOD}/${listingId}/adjustment`, {
    body: {
      expected_listing_revision: listingRevision,
      edit_revision_id: edit.revisionId,
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: expectedAdjustmentRevision,
      content,
      image_plan: imagePlan,
    },
    cookie: mod1.cookie,
    params: { listingId },
  });
}

async function decide(
  route: Route,
  endpoint: string,
  listingId: string,
  body: Record<string, unknown>,
) {
  return api(route, "POST", `${MOD}/${listingId}/${endpoint}`, {
    body,
    cookie: mod1.cookie,
    params: { listingId },
  });
}

async function listingState(listingId: string) {
  const sql = getSql();
  const [row] = await sql<
    {
      status: string;
      revision: number;
      price_minor: string;
      description: string | null;
      current_expires_at: Date | null;
      seller_deactivated_at: Date | null;
      seller_reactivation_requested_at: Date | null;
    }[]
  >`select status, revision, price_minor::text as price_minor, description,
      current_expires_at, seller_deactivated_at, seller_reactivation_requested_at
    from listings where id = ${listingId}`;
  const features = (
    await sql<{ feature_id: string }[]>`
      select feature_id from listing_features where listing_id = ${listingId} order by feature_id
    `
  ).map((f) => f.feature_id);
  const images = await sql<{ storage_path: string; is_primary: boolean }[]>`
    select storage_path, is_primary from listing_images
    where listing_id = ${listingId} order by sort_order
  `;
  const [{ n: periods }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_periods where listing_id = ${listingId}
  `;
  const [{ n: payments }] = await sql<{ n: string }[]>`
    select count(*)::text as n from payments where listing_id = ${listingId}
  `;
  return { ...row, features, images, periods: Number(periods), payments: Number(payments) };
}

async function revisionState(revisionId: string) {
  const sql = getSql();
  const [row] = await sql<{ status: string; data: Record<string, unknown> }[]>`
    select status, data from listing_edit_revisions where id = ${revisionId}
  `;
  const [{ n: staged }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_edit_images where edit_revision_id = ${revisionId}
  `;
  return { status: row.status, data: row.data, stagedCount: Number(staged) };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  seller = await newUser();
  mod1 = await newUser({ roles: ["MODERATOR"] });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('O13DBrand', 'o13d-brand') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  model = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'O13DModel', 'o13d-model') returning id`)[0].id;
  city = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('O13DŞəhər', 'o13d-seher', 99) returning id`)[0].id;
  featA = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O13D_FEAT_A', 'O13D Avadanlıq A', 'SAFETY') returning id`)[0].id;
  featB = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O13D_FEAT_B', 'O13D Avadanlıq B', 'COMFORT') returning id`)[0].id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("adjusted EDIT approval — content swap from the moderator layer", () => {
  it("keeps old public content until approval, then applies Z atomically; seller proposal survives", async () => {
    const listing = await insertActiveListing();
    const edit = await submitEdit(listing.id, {
      price_minor: 2600000,
      description: "Satıcının yeni təsviri",
    });
    await claim(mod1, listing.id);
    // moderator layer Z: scalar + equipment + photo (reorder, remove
    // last, new primary)
    const save = await saveAdjustment(listing.id, edit, listing.revision, {
      price_minor: 2550000,
      feature_ids: [featA, featB],
    }, [
      { source_id: edit.stagedIds[1], removed: false, is_primary: true },
      { source_id: edit.stagedIds[0], removed: false, is_primary: false },
      { source_id: edit.stagedIds[2], removed: false, is_primary: false },
      { source_id: edit.stagedIds[3], removed: true, is_primary: false },
    ]);
    expect(save.status).toBe(200);
    const adjustmentId = (save.body.data?.adjustment as { id: string }).id;

    // §20: BEFORE approval the public listing is the OLD approved X
    const before = await publicDetail(listing.publicId);
    expect(before.listing.priceMinor).toBe(2500000);
    expect(before.listing.images).toHaveLength(4);

    const approve = await decide(editApproveRoute as Route, "edit/approve", listing.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(200);
    const result = approve.body.data as { reactivated: boolean; editRevision: { status: string } };
    expect(result.reactivated).toBe(false);
    expect(result.editRevision.status).toBe("APPROVED");

    // final approved content = Z (moderator layer), pure content swap
    const state = await listingState(listing.id);
    expect(state.status).toBe("ACTIVE");
    expect(state.price_minor).toBe("2550000");
    expect(state.description).toBe("Satıcının yeni təsviri"); // untouched by moderator → seller value applied
    expect(state.features).toEqual([featA, featB].sort());
    expect(state.images.map((img) => img.is_primary)).toEqual([true, false, false]);
    expect(state.revision).toBe(listing.revision + 1); // exactly one bump
    expect(state.periods).toBe(0); // NO new period
    expect(state.payments).toBe(0); // NO fee
    // public shows Z
    const after = await publicDetail(listing.publicId);
    expect(after.listing.priceMinor).toBe(2550000);
    expect(after.listing.images).toHaveLength(3);

    // seller proposal survives untouched (revision.data Y + staged rows)
    const revision = await revisionState(edit.revisionId);
    expect(revision.status).toBe("APPROVED");
    expect(revision.data.price_minor).toBe(2600000);
    expect(revision.stagedCount).toBe(4);

    // review linkage: seller pass AND exact adjustment version
    const [review] = await getSql()<
      { edit_revision_id: string; edit_revision_no: number; adjustment_id: string; adjustment_revision: number }[]
    >`select edit_revision_id, edit_revision_no, adjustment_id, adjustment_revision
      from moderation_reviews where listing_id = ${listing.id}`;
    expect(review).toEqual({
      edit_revision_id: edit.revisionId,
      edit_revision_no: edit.revisionNo,
      adjustment_id: adjustmentId,
      adjustment_revision: 1,
    });
    // adjustment terminal APPLIED with intact evidence
    const [adj] = await getSql()<
      { status: string; submitted_data: Record<string, unknown>; applied_at: Date | null }[]
    >`select status, submitted_data, applied_at from moderation_adjustments where id = ${adjustmentId}`;
    expect(adj.status).toBe("APPLIED");
    expect(adj.applied_at).not.toBeNull();
    expect(adj.submitted_data.price_minor).toBe(2600000); // frozen Y

    // idempotent retry: no double apply/period/cleanup
    const retry = await decide(editApproveRoute as Route, "edit/approve", listing.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 1,
    });
    expect(retry.status).toBe(200);
    const again = await listingState(listing.id);
    expect(again.revision).toBe(listing.revision + 1);
    expect(again.periods).toBe(0);
    const applyEvents = await getSql()<{ id: string }[]>`
      select id from outbox_events
      where aggregate_id = ${listing.id} and event_type = 'MODERATION_ADJUSTMENT_APPLIED'
    `;
    expect(applyEvents).toHaveLength(1);
  });

  it("no-adjustment EDIT approval stays byte-identical O.12 (null linkage, no period)", async () => {
    const listing = await insertActiveListing();
    const edit = await submitEdit(listing.id, { price_minor: 2700000 });
    await claim(mod1, listing.id);
    const approve = await decide(editApproveRoute as Route, "edit/approve", listing.id, {
      expected_edit_revision: edit.revisionNo,
    });
    expect(approve.status).toBe(200);
    const state = await listingState(listing.id);
    expect(state.price_minor).toBe("2700000");
    expect(state.periods).toBe(0);
    expect(state.payments).toBe(0);
    const [review] = await getSql()<{ adjustment_id: string | null; adjustment_revision: number | null }[]>`
      select adjustment_id, adjustment_revision from moderation_reviews where listing_id = ${listing.id}
    `;
    expect(review).toEqual({ adjustment_id: null, adjustment_revision: null });
  });
});

describe("correction / reject with adjustment — sealed non-apply", () => {
  it("correction keeps public X and the SAME seller revision; the next pass starts clean", async () => {
    const listing = await insertActiveListing();
    const edit = await submitEdit(listing.id, { price_minor: 2600000 });
    await claim(mod1, listing.id);
    const save = await saveAdjustment(listing.id, edit, listing.revision, { price_minor: 2580000 }, planFor(edit.stagedIds));
    expect(save.status).toBe(200);
    const adjustmentId = (save.body.data?.adjustment as { id: string }).id;

    const correction = await decide(editCorrectionRoute as Route, "edit/request-correction", listing.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 1,
      reason_code: "INVALID_PHOTOS",
      note: "Şəkilləri yeniləyin.",
    });
    expect(correction.status).toBe(200);

    // public old X; seller proposal untouched; SAME revision entity
    expect((await publicDetail(listing.publicId)).listing.priceMinor).toBe(2500000);
    const revision = await revisionState(edit.revisionId);
    expect(revision.status).toBe("CORRECTION_REQUIRED");
    expect(revision.data.price_minor).toBe(2600000); // never moderator 2580000
    const [adj] = await getSql()<{ status: string }[]>`
      select status from moderation_adjustments where id = ${adjustmentId}
    `;
    expect(adj.status).toBe("DISCARDED");
    // no cleanup intake from a correction
    expect(
      await getSql()<{ id: string }[]>`
        select id from outbox_events
        where aggregate_id = ${listing.id} and event_type = 'MODERATION_ADJUSTMENT_APPLIED'
      `,
    ).toHaveLength(0);

    // seller edits the SAME revision and resubmits → clean new pass
    const patch = await api(editPatchRoute as Route, "PATCH", eb(listing.id), {
      body: { expected_revision: edit.revisionNo, price_minor: 2620000 },
      cookie: seller.cookie,
      params: { listingId: listing.id },
    });
    expect(patch.status).toBe(200);
    const no = (patch.body.data?.listing as { revision: number }).revision;
    const resubmit = await api(editSubmitRoute as Route, "POST", `${eb(listing.id)}/submit`, {
      body: { expected_revision: no },
      cookie: seller.cookie,
      params: { listingId: listing.id },
    });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data?.editRevisionId).toBe(edit.revisionId); // same entity
    await claim(mod1, listing.id);
    const clean = await saveAdjustment(
      listing.id,
      { revisionId: edit.revisionId, revisionNo: resubmit.body.data?.editRevision as number },
      listing.revision,
      { price_minor: 2590000 },
      planFor(edit.stagedIds),
    );
    expect(clean.status).toBe(200);
    const fresh = clean.body.data?.adjustment as { id: string; revision: number };
    expect(fresh.id).not.toBe(adjustmentId);
    expect(fresh.revision).toBe(1);
  });

  it("reject keeps public X and clears the reactivation request per O.12", async () => {
    const listing = await insertActiveListing({ deactivated: true, requested: true });
    const edit = await submitEdit(listing.id, { price_minor: 2600000 });
    await claim(mod1, listing.id);
    const save = await saveAdjustment(listing.id, edit, listing.revision, { price_minor: 2570000 }, planFor(edit.stagedIds));
    const adjustmentId = (save.body.data?.adjustment as { id: string }).id;
    const reject = await decide(editRejectRoute as Route, "edit/reject", listing.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 1,
      reason_code: "MISLEADING_INFO",
      note: "yalnış",
    });
    expect(reject.status).toBe(200);
    const state = await listingState(listing.id);
    expect(state.price_minor).toBe("2500000"); // old approved X untouched
    expect(state.seller_reactivation_requested_at).toBeNull(); // O.12 clearing preserved
    expect((await revisionState(edit.revisionId)).status).toBe("REJECTED");
    expect(
      (await getSql()<{ status: string }[]>`select status from moderation_adjustments where id = ${adjustmentId}`)[0].status,
    ).toBe("DISCARDED");
  });
});

describe("lifecycle matrix — pure content swap, finalizer stays sole visibility writer", () => {
  async function adjustedApprove(spec: Parameters<typeof insertActiveListing>[0]) {
    const listing = await insertActiveListing(spec);
    const edit = await submitEdit(listing.id, { price_minor: 2600000 });
    await claim(mod1, listing.id);
    await saveAdjustment(listing.id, edit, listing.revision, { price_minor: 2560000 }, planFor(edit.stagedIds));
    const approve = await decide(editApproveRoute as Route, "edit/approve", listing.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(200);
    return { listing, result: approve.body.data as { reactivated: boolean } };
  }

  it("DEACTIVATED (no request): content applied, stays hidden, flag untouched", async () => {
    const { listing, result } = await adjustedApprove({ deactivated: true });
    expect(result.reactivated).toBe(false);
    const state = await listingState(listing.id);
    expect(state.price_minor).toBe("2560000");
    expect(state.seller_deactivated_at).not.toBeNull(); // approval never clears it directly
    expect(state.periods).toBe(0);
    await expect(publicDetail(listing.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
  });

  it("DEACTIVATED + requested: central finalizer reactivates — no second mechanism, no period", async () => {
    const { listing, result } = await adjustedApprove({ deactivated: true, requested: true });
    expect(result.reactivated).toBe(true);
    const state = await listingState(listing.id);
    expect(state.seller_deactivated_at).toBeNull();
    expect(state.seller_reactivation_requested_at).toBeNull();
    expect(state.periods).toBe(0);
    expect((await publicDetail(listing.publicId)).listing.priceMinor).toBe(2560000);
  });

  it("EXPIRED: content applied, stays expired/private, expiry untouched, no renewal bypass", async () => {
    const { listing, result } = await adjustedApprove({ status: "EXPIRED", expiresOffsetMin: -60 });
    expect(result.reactivated).toBe(false);
    const state = await listingState(listing.id);
    expect(state.status).toBe("EXPIRED");
    expect(state.price_minor).toBe("2560000");
    expect(state.current_expires_at!.getTime()).toBeLessThan(Date.now());
    expect(state.periods).toBe(0);
    expect(state.payments).toBe(0);
    // O.12 sealed: an expired listing renders only the degraded
    // non-contactable public view — never the live ACTIVE page
    const pub = await publicDetail(listing.publicId);
    expect(pub.listing.status).toBe("EXPIRED");
    expect(pub.listing.contactable).toBe(false);
  });

  it("EXPIRED + deactivated + requested: request preserved for the sealed renewal ordering", async () => {
    const { listing, result } = await adjustedApprove({
      status: "EXPIRED",
      expiresOffsetMin: -60,
      deactivated: true,
      requested: true,
    });
    expect(result.reactivated).toBe(false); // time-valid gate fails
    const state = await listingState(listing.id);
    expect(state.status).toBe("EXPIRED");
    expect(state.seller_deactivated_at).not.toBeNull();
    expect(state.seller_reactivation_requested_at).not.toBeNull(); // preserved for renewal
    expect(state.periods).toBe(0);
  });

  it("SUSPENDED after submission: content applied, listing stays suspended/hidden", async () => {
    const listing = await insertActiveListing();
    const edit = await submitEdit(listing.id, { price_minor: 2600000 });
    await getSql()`update listings set status = 'SUSPENDED' where id = ${listing.id}`;
    await claim(mod1, listing.id);
    await saveAdjustment(listing.id, edit, listing.revision, { price_minor: 2560000 }, planFor(edit.stagedIds));
    const approve = await decide(editApproveRoute as Route, "edit/approve", listing.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(200);
    const state = await listingState(listing.id);
    expect(state.status).toBe("SUSPENDED");
    expect(state.price_minor).toBe("2560000");
    await expect(publicDetail(listing.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
  });
});

describe("concurrency + cleanup", () => {
  it("blind/stale/lost-claim decisions are typed refusals; concurrent approve applies once", async () => {
    const listing = await insertActiveListing();
    const edit = await submitEdit(listing.id, { price_minor: 2600000 });
    await claim(mod1, listing.id);
    await saveAdjustment(listing.id, edit, listing.revision, { price_minor: 2550000 }, planFor(edit.stagedIds));
    // newer save bumps the counter
    await saveAdjustment(listing.id, edit, listing.revision, { price_minor: 2540000 }, planFor(edit.stagedIds), 1);
    // stale view refused
    const stale = await decide(editApproveRoute as Route, "edit/approve", listing.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");
    // blind decision refused
    const blind = await decide(editApproveRoute as Route, "edit/approve", listing.id, {
      expected_edit_revision: edit.revisionNo,
    });
    expect(blind.status).toBe(409);
    expect(blind.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");
    // lost claim refused
    await getSql()`
      update moderation_claims set claimed_at = now() - interval '10 minutes',
        expires_at = now() - interval '1 minute'
      where listing_id = ${listing.id} and released_at is null
    `;
    const unclaimed = await decide(editApproveRoute as Route, "edit/approve", listing.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 2,
    });
    expect(unclaimed.status).toBe(409);
    expect(unclaimed.body.error?.code).toBe("MODERATION_CLAIM_REQUIRED");
    // reclaim → concurrent identical approvals execute once
    await claim(mod1, listing.id);
    const body = { expected_edit_revision: edit.revisionNo, expected_adjustment_revision: 2 };
    const [a, b] = await Promise.all([
      decide(editApproveRoute as Route, "edit/approve", listing.id, body),
      decide(editApproveRoute as Route, "edit/approve", listing.id, body),
    ]);
    expect([a.status, b.status]).toContain(200);
    const state = await listingState(listing.id);
    expect(state.price_minor).toBe("2540000");
    expect(state.revision).toBe(listing.revision + 1);
    expect(
      await getSql()<{ id: string }[]>`
        select id from outbox_events
        where aggregate_id = ${listing.id} and event_type = 'MODERATION_ADJUSTMENT_APPLIED'
      `,
    ).toHaveLength(1);
  });

  it("cleanup: seller-dropped old-public path cleans; moderator-dropped staged path stays history-protected", async () => {
    const listing = await insertActiveListing();
    // seller drops the FIRST original image in the proposal
    const edit = await submitEdit(listing.id, { price_minor: 2600000 }, { dropFirstStagedImage: true });
    expect(edit.stagedIds).toHaveLength(3);
    await claim(mod1, listing.id);
    // moderator keeps all 3 staged (min guard) — cleanup candidate is
    // ONLY the seller-dropped old public path
    await saveAdjustment(listing.id, edit, listing.revision, { price_minor: 2550000 }, planFor(edit.stagedIds));
    const approve = await decide(editApproveRoute as Route, "edit/approve", listing.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(200);
    const [event] = await getSql()<{ id: string; payload: Record<string, unknown> }[]>`
      select id, payload from outbox_events
      where aggregate_id = ${listing.id} and event_type = 'MODERATION_ADJUSTMENT_APPLIED'
    `;
    expect(event.payload.cleanup_candidate_paths).toBe(listing.imagePaths[0]);
    await getSql()`
      update outbox_events set created_at = now() - interval '2 hours' where id = ${event.id}
    `;
    await runImageCleanup({ graceSeconds: 3600 });
    // seller-dropped original: no live row, no staged row, no snapshot → cleaned
    expect(storage.has(BUCKET(), listing.imagePaths[0])).toBe(false);
    // kept paths remain (final gallery + staged history + snapshot)
    expect(storage.has(BUCKET(), listing.imagePaths[1])).toBe(true);
    expect(storage.has(BUCKET(), listing.imagePaths[2])).toBe(true);
    expect(storage.has(BUCKET(), listing.imagePaths[3])).toBe(true);
  });
});
