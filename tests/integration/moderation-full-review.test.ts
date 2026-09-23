import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  createMemoryStorageProvider,
  type MemoryStorageProvider,
} from "@/providers/storage/memory-provider";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import { listingImageConfig } from "@/lib/config/listing-images";
import { createTestUserSession } from "./helpers/session";
import { api, type Route } from "./helpers/listing";
import {
  PATCH as editPatchRoute,
  POST as editCreateRoute,
} from "@/app/api/v1/me/listings/[listingId]/edit-revision/route";
import { POST as editSubmitRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/submit/route";
import { GET as detailRoute } from "@/app/api/v1/moderator/listings/[listingId]/route";

/**
 * O.13 Stage A — full moderator data read model. The staff detail must
 * expose the COMPLETE seller marketplace content for both moderation
 * types: resolved labels, full O.11-grouped equipment, ordered images
 * with the primary marker, and the full authorized marketplace contact
 * value — while the LISTING_EDIT changed-first diff stays intact and
 * nothing beyond the staff surface gains the data.
 */

const SELLER_BASE = "http://localhost/api/v1/me/listings";
const MOD = "http://localhost/api/v1/moderator/listings";
/** Full authorized marketplace contact — deliberately distinct from
    every account phone so leak assertions are unambiguous. */
const CONTACT = "+994701112233";

let storage: MemoryStorageProvider;
let carCat: string;
let brand: string;
let model: string;
let city: string;
let petrol: string;
let featSafety: string;
let featComfort: string;
let featLegacy: string;
let phoneCounter = 6_400_000;
type Session = { userId: string; cookie: string };
let seller: Session;
let moderator: Session;

async function newUser(opts: { blocked?: boolean; roles?: string[] } = {}): Promise<Session> {
  phoneCounter += 1;
  return createTestUserSession(`+99451${phoneCounter}`, opts);
}

async function insertListing(spec: {
  status: "PENDING_MODERATION" | "ACTIVE";
  features?: string[];
  images?: number;
}): Promise<{ id: string }> {
  const sql = getSql();
  const active = spec.status === "ACTIVE";
  const [row] = await sql<{ id: string }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
      mileage, engine_cc, fuel_type_id, credit_available, barter_available, no_accident,
      description, contact_phone_e164, seller_name, status, submitted_at, published_at,
      current_expires_at)
    values (${seller.userId}, ${carCat}, ${brand}, ${model}, ${city}, 2022, 3300000,
      41000, 1998, ${petrol}, true, false, true,
      'O13A tam təsvir', ${CONTACT}, 'O13A Satıcı',
      ${spec.status}::listing_status, now() - interval '2 days',
      ${active ? sql`now() - interval '1 day'` : null},
      ${active ? sql`now() + interval '20 days'` : null})
    returning id
  `;
  for (let i = 0; i < (spec.images ?? 3); i += 1) {
    const path = `listings/${randomUUID()}.webp`;
    storage.objects.set(`${listingImageConfig().imagesBucket}/${path}`, {
      data: Buffer.from("img"),
      contentType: "image/webp",
    });
    await sql`
      insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${row.id}, ${path}, ${i}, ${i === 1}, 'image/webp', 1000, 1600, 900)
    `;
  }
  for (const f of spec.features ?? []) {
    await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${f})`;
  }
  return { id: row.id };
}

const eb = (id: string): string => `${SELLER_BASE}/${id}/edit-revision`;

async function submitEdit(listingId: string, changes: Record<string, unknown>): Promise<number> {
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
  return submit.body.data?.editRevision as number;
}

async function detailAs(session: Session, listingId: string) {
  return api(detailRoute as Route, "GET", `${MOD}/${listingId}`, {
    cookie: session.cookie,
    params: { listingId },
  });
}

type FeatureGroup = { code: string; label: string; features: { id: string; label: string; selected: boolean }[] };
type Image = { id: string; sortOrder: number; isPrimary: boolean; url: string | null };

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  seller = await newUser();
  moderator = await newUser({ roles: ["MODERATOR"] });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('O13ABrand', 'o13a-brand') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  model = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'O13AModel', 'o13a-model') returning id`)[0].id;
  city = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('O13AŞəhər', 'o13a-seher', 96) returning id`)[0].id;
  petrol = (await sql<{ id: string }[]>`select id from reference_options where group_code = 'FUEL_TYPE' and code = 'PETROL'`)[0].id;
  featSafety = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O13A_SAFETY', 'O13A Təhlükəsizlik avadanlığı', 'SAFETY') returning id`)[0].id;
  featComfort = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O13A_COMFORT', 'O13A Komfort avadanlığı', 'COMFORT') returning id`)[0].id;
  // legacy row without a group code — must land in the trailing Digər bucket
  featLegacy = (await sql<{ id: string }[]>`insert into features (code, name_az) values ('O13A_LEGACY', 'O13A Köhnə avadanlıq') returning id`)[0].id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("NEW_LISTING full read model", () => {
  it("exposes every seller field resolved, full grouped equipment, ordered images with primary, and the full contact", async () => {
    const listing = await insertListing({
      status: "PENDING_MODERATION",
      features: [featComfort, featSafety, featLegacy],
    });
    const r = await detailAs(moderator, listing.id);
    expect(r.status).toBe(200);
    const d = r.body.data?.listing as Record<string, unknown>;

    // complete scalar coverage with server-resolved labels
    expect((d.brand as { name: string }).name).toBe("O13ABrand");
    expect((d.model as { name: string }).name).toBe("O13AModel");
    expect(d.year).toBe(2022);
    expect(d.priceMinor).toBe(3300000);
    expect(d.mileage).toBe(41000);
    expect(d.engineCc).toBe(1998);
    expect(d.fuelType).toBe("Benzin");
    expect(d.cityName).toBe("O13AŞəhər");
    expect(d.creditAvailable).toBe(true);
    expect(d.barterAvailable).toBe(false);
    expect(d.noAccident).toBe(true);
    expect(d.notRepainted).toBeNull();
    expect(d.description).toBe("O13A tam təsvir");
    expect(d.sellerName).toBe("O13A Satıcı");

    // O.13 equipment gap fixed: full names, O.11 group order, Digər last
    const groups = d.featureGroups as FeatureGroup[];
    expect(groups.map((g) => g.code)).toEqual(["SAFETY", "COMFORT", "OTHER_FALLBACK"]);
    expect(groups.map((g) => g.label)).toEqual(["Təhlükəsizlik", "Komfort", "Digər"]);
    expect(groups[0].features).toEqual([
      { id: featSafety, label: "O13A Təhlükəsizlik avadanlığı", selected: true },
    ]);
    expect(groups[1].features[0].label).toBe("O13A Komfort avadanlığı");
    expect(groups[2].features[0].label).toBe("O13A Köhnə avadanlıq");

    // ordered gallery with a stable primary marker + signed URLs only
    const images = d.images as Image[];
    expect(images.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(images.map((i) => i.isPrimary)).toEqual([false, true, false]);
    expect(images.every((i) => typeof i.url === "string" && i.url.length > 0)).toBe(true);

    // full authorized marketplace contact for staff review; the seller
    // ACCOUNT phone stays masked and never leaks raw
    expect(d.contactPhone).toBe(CONTACT);
    const raw = JSON.stringify(d);
    expect(raw).not.toContain("+99451");
    expect(raw).not.toMatch(/storage_?[pP]ath/);
  });

  it("empty selection yields an empty group list — never a fabricated group", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION", features: [] });
    const r = await detailAs(moderator, listing.id);
    expect(r.status).toBe(200);
    expect((r.body.data?.listing as { featureGroups: unknown[] }).featureGroups).toEqual([]);
  });

  it("stays staff-only: a plain USER gets 403, unauthenticated 401", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    const user = await newUser();
    expect((await detailAs(user, listing.id)).status).toBe(403);
    const anon = await api(detailRoute as Route, "GET", `${MOD}/${listing.id}`, {
      params: { listingId: listing.id },
    });
    expect(anon.status).toBe(401);
  });
});

describe("LISTING_EDIT full read model", () => {
  it("exposes the complete proposed content (not diff-only) beside the intact changed-first diff and the full approved layer", async () => {
    const listing = await insertListing({ status: "ACTIVE", features: [featSafety] });
    await submitEdit(listing.id, {
      price_minor: 3500000,
      feature_ids: [featSafety, featComfort],
    });
    const r = await detailAs(moderator, listing.id);
    expect(r.status).toBe(200);
    const d = r.body.data?.listing as Record<string, unknown>;
    const review = d.editReview as {
      scalarChanges: { field: string; oldValue: string | null; newValue: string | null }[];
      equipmentAdded: string[];
      equipmentRemoved: string[];
      sellerSubmitted: Record<string, unknown>;
    };

    // O.12 changed-first diff preserved verbatim
    const price = review.scalarChanges.find((c) => c.field === "price");
    expect(price).toEqual({ field: "price", oldValue: "33 000 AZN", newValue: "35 000 AZN" });
    expect(review.equipmentAdded).toEqual(["O13A Komfort avadanlığı"]);
    expect(review.equipmentRemoved).toEqual([]);

    // the FULL proposed listing: unchanged values included, labels resolved
    const proposed = review.sellerSubmitted;
    expect(proposed.brandName).toBe("O13ABrand");
    expect(proposed.modelName).toBe("O13AModel");
    expect(proposed.year).toBe(2022);
    expect(proposed.priceMinor).toBe(3500000);
    expect(proposed.mileage).toBe(41000);
    expect(proposed.fuelType).toBe("Benzin");
    expect(proposed.cityName).toBe("O13AŞəhər");
    expect(proposed.noAccident).toBe(true);
    expect(proposed.description).toBe("O13A tam təsvir");
    expect(proposed.sellerName).toBe("O13A Satıcı");
    expect(proposed.contactPhone).toBe(CONTACT);

    // FULL proposed equipment set — the kept feature appears alongside
    // the added one, grouped in O.11 order
    const groups = proposed.featureGroups as FeatureGroup[];
    expect(groups.map((g) => g.code)).toEqual(["SAFETY", "COMFORT"]);
    expect(groups[0].features[0]).toEqual({
      id: featSafety,
      label: "O13A Təhlükəsizlik avadanlığı",
      selected: true,
    });
    expect(groups[1].features[0].label).toBe("O13A Komfort avadanlığı");

    // full proposed gallery in staged order with the primary marker
    const proposedImages = proposed.images as Image[];
    expect(proposedImages.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(proposedImages.map((i) => i.isPrimary)).toEqual([false, true, false]);
    expect(proposedImages.every((i) => typeof i.url === "string" && i.url.length > 0)).toBe(true);

    // the current approved layer stays fully readable at the top level
    expect(d.priceMinor).toBe(3300000);
    const approvedGroups = d.featureGroups as FeatureGroup[];
    expect(approvedGroups.map((g) => g.code)).toEqual(["SAFETY"]);

    // staff-only surface: no raw account phone, no storage internals
    const raw = JSON.stringify(d);
    expect(raw).not.toContain("+99451");
    expect(raw).not.toMatch(/storage_?[pP]ath/);
  });
});
