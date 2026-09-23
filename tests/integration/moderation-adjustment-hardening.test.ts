import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  createMemoryStorageProvider,
  type MemoryStorageProvider,
} from "@/providers/storage/memory-provider";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import { listingImageConfig } from "@/lib/config/listing-images";
import { runImageCleanup } from "@/services/lifecycle-jobs";
import {
  applyAdjustmentRow,
  discardAdjustmentRow,
  getAdjustmentById,
  updateAdjustmentWorkingState,
} from "@/repositories/moderation-adjustments";
import { createTestUserSession } from "./helpers/session";
import { api, type Route } from "./helpers/listing";
import {
  PATCH as editPatchRoute,
  POST as editCreateRoute,
} from "@/app/api/v1/me/listings/[listingId]/edit-revision/route";
import { POST as editSubmitRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/submit/route";
import { POST as claimRoute } from "@/app/api/v1/moderator/listings/[listingId]/claim/route";
import { POST as approveRoute } from "@/app/api/v1/moderator/listings/[listingId]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/moderator/listings/[listingId]/reject/route";
import { POST as correctionRoute } from "@/app/api/v1/moderator/listings/[listingId]/request-correction/route";
import { POST as editApproveRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/approve/route";
import { POST as editCorrectionRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/request-correction/route";
import { PUT as adjustmentSaveRoute } from "@/app/api/v1/moderator/listings/[listingId]/adjustment/route";
import { POST as adjustmentDiscardRoute } from "@/app/api/v1/moderator/listings/[listingId]/adjustment/discard/route";

/**
 * O.13 Stage E — hardening matrix. Deterministic proofs (no sleeps —
 * claim expiry through the DB clock, races serialized by row locks)
 * for: the two-moderator and two-tab stale matrices, save/discard vs
 * approve outcomes, terminal immutability, multi-moderator audit
 * reconstruction, evidence survival across correction-resubmit,
 * legacy-shape EDIT parity, catalog/image/feature drift, cleanup
 * idempotency, payload allowlist, and terminal-decision retries.
 */

const SELLER_BASE = "http://localhost/api/v1/me/listings";
const MOD = "http://localhost/api/v1/moderator/listings";
const BUCKET = () => listingImageConfig().imagesBucket;

let storage: MemoryStorageProvider;
let carCat: string;
let brand: string;
let model: string;
let city: string;
let featA: string;
let phoneCounter = 6_800_000;
type Session = { userId: string; cookie: string };
let seller: Session;
let modA: Session;
let modB: Session;

async function newUser(opts: { roles?: string[]; name?: string } = {}): Promise<Session> {
  phoneCounter += 1;
  const session = await createTestUserSession(`+99451${phoneCounter}`, opts);
  if (opts.name !== undefined) {
    await getSql()`update users set display_name = ${opts.name} where id = ${session.userId}`;
  }
  return session;
}

async function insertListing(spec: {
  status: "PENDING_MODERATION" | "ACTIVE";
  sellerName?: string | null;
  brandId?: string;
  features?: string[];
}): Promise<{ id: string; publicId: number; revision: number; imageIds: string[]; imagePaths: string[] }> {
  const sql = getSql();
  const active = spec.status === "ACTIVE";
  const [row] = await sql<{ id: string; public_id: string; revision: number }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
      mileage, credit_available, barter_available, description, contact_phone_e164, seller_name,
      status, submitted_at, published_at, current_expires_at)
    values (${seller.userId}, ${carCat}, ${spec.brandId ?? brand}, ${spec.brandId === undefined ? model : null},
      ${city}, 2021, 2500000, 50000, false, false, 'O13E təsvir', '+994701116666',
      ${spec.sellerName === undefined ? "O13E Satıcı" : spec.sellerName},
      ${spec.status}::listing_status, now() - interval '2 days',
      ${active ? sql`now() - interval '1 day'` : null},
      ${active ? sql`now() + interval '20 days'` : null})
    returning id, public_id::text as public_id, revision
  `;
  const imageIds: string[] = [];
  const imagePaths: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const path = `listings/${randomUUID()}.webp`;
    imagePaths.push(path);
    storage.objects.set(`${BUCKET()}/${path}`, { data: Buffer.from("x"), contentType: "image/webp" });
    const [image] = await sql<{ id: string }[]>`
      insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${row.id}, ${path}, ${i}, ${i === 0}, 'image/webp', 1000, 1600, 900)
      returning id
    `;
    imageIds.push(image.id);
  }
  for (const f of spec.features ?? [featA]) {
    await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${f})`;
  }
  return { id: row.id, publicId: Number(row.public_id), revision: row.revision, imageIds, imagePaths };
}

const eb = (id: string): string => `${SELLER_BASE}/${id}/edit-revision`;

async function submitEdit(listingId: string, changes: Record<string, unknown>) {
  const create = await api(editCreateRoute as Route, "POST", eb(listingId), {
    cookie: seller.cookie,
    params: { listingId },
  });
  expect(create.status).toBe(200);
  let no = (create.body.data?.listing as { revision: number }).revision;
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
    stagedIds: staged.map((r) => r.id),
  };
}

async function claim(session: Session, listingId: string) {
  return api(claimRoute as Route, "POST", `${MOD}/${listingId}/claim`, {
    cookie: session.cookie,
    params: { listingId },
  });
}

async function expireClaim(listingId: string): Promise<void> {
  await getSql()`
    update moderation_claims
    set claimed_at = now() - interval '10 minutes', expires_at = now() - interval '1 minute'
    where listing_id = ${listingId} and released_at is null
  `;
}

function planFor(imageIds: string[]) {
  return imageIds.map((id, index) => ({ source_id: id, removed: false, is_primary: index === 0 }));
}

async function save(session: Session, listingId: string, body: Record<string, unknown>) {
  return api(adjustmentSaveRoute as Route, "PUT", `${MOD}/${listingId}/adjustment`, {
    body,
    cookie: session.cookie,
    params: { listingId },
  });
}

async function discard(session: Session, listingId: string, expectedRevision: number) {
  return api(adjustmentDiscardRoute as Route, "POST", `${MOD}/${listingId}/adjustment/discard`, {
    body: { expected_adjustment_revision: expectedRevision },
    cookie: session.cookie,
    params: { listingId },
  });
}

async function decideAs(session: Session, route: Route, endpoint: string, listingId: string, body: Record<string, unknown>) {
  return api(route, "POST", `${MOD}/${listingId}/${endpoint}`, {
    body,
    cookie: session.cookie,
    params: { listingId },
  });
}

function newSaveBody(listing: { revision: number; imageIds: string[] }, content: Record<string, unknown>, expected: number | null = null) {
  return {
    expected_listing_revision: listing.revision,
    expected_adjustment_revision: expected,
    content,
    image_plan: planFor(listing.imageIds),
  };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  seller = await newUser();
  modA = await newUser({ roles: ["MODERATOR"], name: "Lalə" });
  modB = await newUser({ roles: ["MODERATOR"], name: "Tural" });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('O13EBrand', 'o13e-brand') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  model = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'O13EModel', 'o13e-model') returning id`)[0].id;
  city = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('O13EŞəhər', 'o13e-seher', 100) returning id`)[0].id;
  featA = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O13E_FEAT_A', 'O13E Avadanlıq A', 'SAFETY') returning id`)[0].id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("race matrices", () => {
  it("two moderators: EVERY stale action from the previous claim owner fails safely", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, listing.id);
    expect((await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000 }))).status).toBe(200);
    await expireClaim(listing.id);
    await claim(modB, listing.id);
    expect((await save(modB, listing.id, newSaveBody(listing, { price_minor: 2410000 }, 1))).status).toBe(200);

    const staleActions: [string, () => Promise<{ status: number; body: { error?: { code?: string } } }>][] = [
      ["save", () => save(modA, listing.id, newSaveBody(listing, { price_minor: 2300000 }, 2))],
      ["discard", () => discard(modA, listing.id, 2)],
      ["approve", () => decideAs(modA, approveRoute as Route, "approve", listing.id, { expected_revision: listing.revision, expected_adjustment_revision: 2 })],
      ["correction", () => decideAs(modA, correctionRoute as Route, "request-correction", listing.id, { expected_revision: listing.revision, expected_adjustment_revision: 2, reason_code: "INVALID_PHOTOS", note: "n" })],
      ["reject", () => decideAs(modA, rejectRoute as Route, "reject", listing.id, { expected_revision: listing.revision, expected_adjustment_revision: 2, reason_code: "MISLEADING_INFO", note: "n" })],
    ];
    for (const [, action] of staleActions) {
      const r = await action();
      expect(r.status).toBe(409);
      expect(r.body.error?.code).toBe("MODERATION_CLAIMED_BY_OTHER");
    }
    // nothing applied; B's working copy intact at revision 2
    const [adj] = await getSql()<{ status: string; revision: number; moderator_id: string }[]>`
      select status, revision, moderator_id from moderation_adjustments where listing_id = ${listing.id}
    `;
    expect(adj).toEqual({ status: "OPEN", revision: 2, moderator_id: modB.userId });
  });

  it("two tabs, same claim: every action carrying a stale adjustment counter is a typed conflict", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, listing.id);
    await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000 }));
    await save(modA, listing.id, newSaveBody(listing, { price_minor: 2420000 }, 1)); // tab A → rev 2

    const staleTabB: [string, () => Promise<{ status: number; body: { error?: { code?: string } } }>][] = [
      ["save", () => save(modA, listing.id, newSaveBody(listing, { price_minor: 2430000 }, 1))],
      ["discard", () => discard(modA, listing.id, 1)],
      ["approve", () => decideAs(modA, approveRoute as Route, "approve", listing.id, { expected_revision: listing.revision, expected_adjustment_revision: 1 })],
      ["correction", () => decideAs(modA, correctionRoute as Route, "request-correction", listing.id, { expected_revision: listing.revision, expected_adjustment_revision: 1, reason_code: "INVALID_PHOTOS", note: "n" })],
      ["reject", () => decideAs(modA, rejectRoute as Route, "reject", listing.id, { expected_revision: listing.revision, expected_adjustment_revision: 1, reason_code: "MISLEADING_INFO", note: "n" })],
    ];
    for (const [, action] of staleTabB) {
      const r = await action();
      expect(r.status).toBe(409);
      expect(r.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");
    }
  });

  it("save/discard AFTER approval and approve AFTER discard are typed conflicts — one terminal outcome only", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, listing.id);
    await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000 }));
    expect(
      (await decideAs(modA, approveRoute as Route, "approve", listing.id, { expected_revision: listing.revision, expected_adjustment_revision: 1 })).status,
    ).toBe(200);
    // save after approve (update path): the moderation pass itself is
    // gone (subject check precedes the adjustment lookup by design)
    const lateUpdate = await save(modA, listing.id, newSaveBody(listing, { price_minor: 2350000 }, 1));
    expect(lateUpdate.status).toBe(409);
    expect(lateUpdate.body.error?.code).toBe("MODERATION_SUBJECT_CHANGED");
    // save after approve (first-save path): the moderation pass is gone
    const lateFirst = await save(modA, listing.id, newSaveBody(listing, { price_minor: 2350000 }, null));
    expect(lateFirst.status).toBe(409);
    expect(lateFirst.body.error?.code).toBe("MODERATION_SUBJECT_CHANGED");
    // discard after approve: the decision released the claim, so the
    // claim gate refuses first — equally safe, equally typed
    const lateDiscard = await discard(modA, listing.id, 1);
    expect(lateDiscard.status).toBe(409);
    expect(lateDiscard.body.error?.code).toBe("MODERATION_CLAIM_REQUIRED");
    const [adj] = await getSql()<{ status: string }[]>`
      select status from moderation_adjustments where listing_id = ${listing.id}
    `;
    expect(adj.status).toBe("APPLIED"); // never dual-terminal

    // approve AFTER discard on a second listing
    const other = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, other.id);
    await save(modA, other.id, newSaveBody(other, { price_minor: 2440000 }));
    expect((await discard(modA, other.id, 1)).status).toBe(200);
    const lateApprove = await decideAs(modA, approveRoute as Route, "approve", other.id, {
      expected_revision: other.revision,
      expected_adjustment_revision: 1,
    });
    expect(lateApprove.status).toBe(409);
    expect(lateApprove.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");
    expect(
      (await getSql()<{ status: string }[]>`select status from moderation_adjustments where listing_id = ${other.id}`)[0].status,
    ).toBe("DISCARDED");
  });

  it("concurrent discard vs approve: exactly one terminal outcome wins and review/audit match it", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, listing.id);
    await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000 }));
    const [approveRes, discardRes] = await Promise.all([
      decideAs(modA, approveRoute as Route, "approve", listing.id, {
        expected_revision: listing.revision,
        expected_adjustment_revision: 1,
      }),
      discard(modA, listing.id, 1),
    ]);
    const [adj] = await getSql()<{ status: string }[]>`
      select status from moderation_adjustments where listing_id = ${listing.id}
    `;
    expect(["APPLIED", "DISCARDED"]).toContain(adj.status);
    const reviews = await getSql()<{ decision: string; adjustment_id: string | null }[]>`
      select decision, adjustment_id from moderation_reviews where listing_id = ${listing.id}
    `;
    if (adj.status === "APPLIED") {
      expect(approveRes.status).toBe(200);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].adjustment_id).not.toBeNull();
      const [{ status }] = await getSql()<{ status: string }[]>`select status from listings where id = ${listing.id}`;
      expect(status).toBe("ACTIVE");
    } else {
      expect(discardRes.status).toBe(200);
      expect(approveRes.status).toBe(409);
      expect(reviews).toHaveLength(0);
      const [{ status }] = await getSql()<{ status: string }[]>`select status from listings where id = ${listing.id}`;
      expect(status).toBe("PENDING_MODERATION");
    }
    // audit lineage matches the winner exactly once
    const audits = await getSql()<{ action: string }[]>`
      select action from audit_logs
      where entity_id = ${listing.id}
        and action in ('MODERATION_ADJUSTMENT_APPLIED', 'MODERATION_ADJUSTMENT_DISCARDED')
    `;
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe(
      adj.status === "APPLIED" ? "MODERATION_ADJUSTMENT_APPLIED" : "MODERATION_ADJUSTMENT_DISCARDED",
    );
  });
});

describe("terminal immutability + audit reconstruction", () => {
  it("terminal rows are repo-level immutable: no update/discard/apply mutates them", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, listing.id);
    const saved = await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000 }));
    const adjustmentId = (saved.body.data?.adjustment as { id: string }).id;
    await decideAs(modA, approveRoute as Route, "approve", listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
    });
    const before = await getAdjustmentById(getSql(), adjustmentId);
    expect(before!.status).toBe("APPLIED");
    // every mutation primitive is status-guarded to OPEN
    expect(
      await updateAdjustmentWorkingState(getSql(), {
        adjustmentId,
        expectedRevision: before!.revision,
        adjustedData: { price_minor: 1 },
        imagePlan: [],
        moderatorId: modA.userId,
      }),
    ).toBeUndefined();
    expect(
      await discardAdjustmentRow(getSql(), { adjustmentId, expectedRevision: before!.revision }),
    ).toBeUndefined();
    expect(
      await applyAdjustmentRow(getSql(), { adjustmentId, expectedRevision: before!.revision }),
    ).toBeUndefined();
    const after = await getAdjustmentById(getSql(), adjustmentId);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("NEW lineage X → A:Y → B:Z → APPROVED reconstructs entirely from persisted artifacts", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, listing.id);
    await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000 })); // A: X→Y
    await expireClaim(listing.id);
    await claim(modB, listing.id);
    await save(modB, listing.id, newSaveBody(listing, { price_minor: 2450000 }, 1)); // B: Y→Z
    await decideAs(modB, approveRoute as Route, "approve", listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 2,
    });

    const [adj] = await getSql()<
      { id: string; status: string; submitted_data: Record<string, unknown>; adjusted_data: Record<string, unknown> }[]
    >`select id, status, submitted_data, adjusted_data from moderation_adjustments where listing_id = ${listing.id}`;
    expect(adj.status).toBe("APPLIED");
    expect(adj.submitted_data.price_minor).toBe(2500000); // X preserved
    expect(adj.adjusted_data.price_minor).toBe(2450000); // final Z
    const saves = await getSql()<{ actor_user_id: string; after_data: Record<string, unknown> }[]>`
      select actor_user_id, after_data from audit_logs
      where entity_id = ${listing.id} and action = 'MODERATION_ADJUSTMENT_SAVED'
      order by created_at
    `;
    expect(saves.map((s) => s.actor_user_id)).toEqual([modA.userId, modB.userId]);
    expect(saves.map((s) => s.after_data.adjustment_revision)).toEqual([1, 2]);
    expect(saves[0].after_data.changed_fields).toContain("price_minor");
    const [review] = await getSql()<{ adjustment_id: string; adjustment_revision: number; moderator_id: string }[]>`
      select adjustment_id, adjustment_revision, moderator_id from moderation_reviews where listing_id = ${listing.id}
    `;
    expect(review).toEqual({ adjustment_id: adj.id, adjustment_revision: 2, moderator_id: modB.userId });
    const [{ price_minor }] = await getSql()<{ price_minor: string }[]>`
      select price_minor::text as price_minor from listings where id = ${listing.id}
    `;
    expect(price_minor).toBe("2450000"); // final approved = Z
  });

  it("EDIT: the seller proposal Y1 stays recoverable from the DISCARDED snapshot even after correction + resubmission mutates the same revision", async () => {
    const listing = await insertListing({ status: "ACTIVE" });
    const edit = await submitEdit(listing.id, { price_minor: 2610000 }); // Y1
    await claim(modA, listing.id);
    const saved = await save(modA, listing.id, {
      expected_listing_revision: listing.revision,
      edit_revision_id: edit.revisionId,
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: null,
      content: { price_minor: 2590000 },
      image_plan: planFor(edit.stagedIds),
    });
    const adjustmentId = (saved.body.data?.adjustment as { id: string }).id;
    const correction = await decideAs(modA, editCorrectionRoute as Route, "edit/request-correction", listing.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 1,
      reason_code: "INVALID_PHOTOS",
      note: "n",
    });
    expect(correction.status).toBe(200);
    // seller mutates the SAME revision entity to Y2 and resubmits
    const patch = await api(editPatchRoute as Route, "PATCH", eb(listing.id), {
      body: { expected_revision: edit.revisionNo, price_minor: 2640000 },
      cookie: seller.cookie,
      params: { listingId: listing.id },
    });
    const no = (patch.body.data?.listing as { revision: number }).revision;
    await api(editSubmitRoute as Route, "POST", `${eb(listing.id)}/submit`, {
      body: { expected_revision: no },
      cookie: seller.cookie,
      params: { listingId: listing.id },
    });
    // frozen evidence still Y1; live revision is Y2
    const [adj] = await getSql()<{ submitted_data: Record<string, unknown>; status: string }[]>`
      select submitted_data, status from moderation_adjustments where id = ${adjustmentId}
    `;
    expect(adj.status).toBe("DISCARDED");
    expect(adj.submitted_data.price_minor).toBe(2610000);
    const [rev] = await getSql()<{ data: Record<string, unknown> }[]>`
      select data from listing_edit_revisions where id = ${edit.revisionId}
    `;
    expect(rev.data.price_minor).toBe(2640000);
  });

  it("terminal correction retry is idempotent: one review, one discard event, same outcome", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, listing.id);
    await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000 }));
    const body = {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
      reason_code: "INVALID_PHOTOS",
      note: "Şəkilləri yeniləyin.",
    };
    expect((await decideAs(modA, correctionRoute as Route, "request-correction", listing.id, body)).status).toBe(200);
    expect((await decideAs(modA, correctionRoute as Route, "request-correction", listing.id, body)).status).toBe(200);
    const reviews = await getSql()<{ id: string }[]>`
      select id from moderation_reviews where listing_id = ${listing.id}
    `;
    expect(reviews).toHaveLength(1);
    const discards = await getSql()<{ id: string }[]>`
      select id from audit_logs
      where entity_id = ${listing.id} and action = 'MODERATION_ADJUSTMENT_DISCARDED'
    `;
    expect(discards).toHaveLength(1);
  });
});

describe("drift + legacy parity + allowlist + cleanup idempotency", () => {
  it("legacy-shaped EDIT parity: O.12 submit completeness means the seller completes the field; adjusted approval then passes; degradation refused", async () => {
    // Unlike NEW, a legacy-shaped EDIT submission cannot exist by
    // construction: every listing_edit_revision passes the O.12 submit
    // validator, which requires seller_name. The real journey on a
    // legacy approved listing is: the wizard makes the seller complete
    // the field, THEN the pass proceeds — adjusted approval is never
    // stricter than that baseline.
    const legacy = await insertListing({ status: "ACTIVE", sellerName: null });
    const edit = await submitEdit(legacy.id, { price_minor: 2620000, seller_name: "Yeni Satıcı" });
    await claim(modA, legacy.id);
    await save(modA, legacy.id, {
      expected_listing_revision: legacy.revision,
      edit_revision_id: edit.revisionId,
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: null,
      content: { price_minor: 2600000 },
      image_plan: planFor(edit.stagedIds),
    });
    const approve = await decideAs(modA, editApproveRoute as Route, "edit/approve", legacy.id, {
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(200); // never stricter than plain O.12 approval

    // degradation on EDIT: moderator clears a field the proposal HAD
    const complete = await insertListing({ status: "ACTIVE" });
    const edit2 = await submitEdit(complete.id, { price_minor: 2620000 });
    await claim(modA, complete.id);
    await save(modA, complete.id, {
      expected_listing_revision: complete.revision,
      edit_revision_id: edit2.revisionId,
      expected_edit_revision: edit2.revisionNo,
      expected_adjustment_revision: null,
      content: { seller_name: null },
      image_plan: planFor(edit2.stagedIds),
    });
    const refused = await decideAs(modA, editApproveRoute as Route, "edit/approve", complete.id, {
      expected_edit_revision: edit2.revisionNo,
      expected_adjustment_revision: 1,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error?.code).toBe("LISTING_INCOMPLETE");
  });

  it("catalog drift: a brand deactivated after save refuses adjusted approval with a typed error", async () => {
    const sql = getSql();
    const driftBrand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('O13EDrift', 'o13e-drift') returning id`)[0].id;
    await sql`insert into brand_categories (brand_id, category_id) values (${driftBrand}, ${carCat})`;
    const listing = await insertListing({ status: "PENDING_MODERATION", brandId: driftBrand });
    await claim(modA, listing.id);
    await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000 }));
    await sql`update brands set is_active = false where id = ${driftBrand}`;
    const approve = await decideAs(modA, approveRoute as Route, "approve", listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(400);
    expect(approve.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
    // nothing applied; historical value untouched
    const [{ status }] = await sql<{ status: string }[]>`select status from listings where id = ${listing.id}`;
    expect(status).toBe("PENDING_MODERATION");
  });

  it("image source drift: a vanished frozen source fails approval safely — never a substitute image", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, listing.id);
    await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000 }));
    await getSql()`delete from listing_images where id = ${listing.imageIds[2]}`;
    const approve = await decideAs(modA, approveRoute as Route, "approve", listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(409);
    expect(approve.body.error?.code).toBe("MODERATION_SUBJECT_CHANGED");
  });

  it("feature drift: a feature deactivated after save refuses adjusted approval", async () => {
    const sql = getSql();
    const driftFeat = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O13E_DRIFT', 'O13E Drift', 'COMFORT') returning id`)[0].id;
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, listing.id);
    await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000, feature_ids: [featA, driftFeat] }));
    await sql`update features set is_active = false where id = ${driftFeat}`;
    const approve = await decideAs(modA, approveRoute as Route, "approve", listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(400);
    expect(approve.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
  });

  it("payload allowlist: lifecycle/commercial/identity keys cannot even parse", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(modA, listing.id);
    for (const poison of [
      { status: "ACTIVE" },
      { published_at: new Date().toISOString() },
      { current_expires_at: new Date().toISOString() },
      { seller_deactivated_at: null },
      { owner_id: modA.userId },
      { public_id: 1 },
      { premium_intent_package_id: randomUUID() },
    ]) {
      const r = await save(modA, listing.id, newSaveBody(listing, { price_minor: 2400000, ...poison }));
      expect(r.status).toBe(400);
      expect(r.body.error?.code).toBe("VALIDATION_ERROR");
    }
    expect(
      await getSql()<{ id: string }[]>`select id from moderation_adjustments where listing_id = ${listing.id}`,
    ).toHaveLength(0);
  });

  it("cleanup worker stays idempotent when the same orphan path arrives in multiple events", async () => {
    const sql = getSql();
    const listing = await insertListing({ status: "ACTIVE" });
    const orphan = `listings/${randomUUID()}.webp`;
    storage.objects.set(`${BUCKET()}/${orphan}`, { data: Buffer.from("x"), contentType: "image/webp" });
    for (let i = 0; i < 2; i += 1) {
      await sql`
        insert into outbox_events (event_type, aggregate_type, aggregate_id, payload, created_at)
        values ('MODERATION_ADJUSTMENT_APPLIED', 'listing', ${listing.id},
          ${sql.json({ listing_id: listing.id, cleanup_candidate_paths: orphan })},
          now() - interval '2 hours')
      `;
    }
    const summary = await runImageCleanup({ graceSeconds: 3600 });
    expect(summary.events).toBeGreaterThanOrEqual(2);
    expect(storage.has(BUCKET(), orphan)).toBe(false);
    const events = await sql<{ status: string }[]>`
      select status::text as status from outbox_events
      where aggregate_id = ${listing.id} and event_type = 'MODERATION_ADJUSTMENT_APPLIED'
    `;
    expect(events.map((e) => e.status)).toEqual(["PROCESSED", "PROCESSED"]);
  });
});
