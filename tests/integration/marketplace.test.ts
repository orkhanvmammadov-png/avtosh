import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  createMemoryStorageProvider,
  type MemoryStorageProvider,
} from "@/providers/storage/memory-provider";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import { createTestUserSession } from "./helpers/session";
import { api } from "./helpers/listing";
import { GET as searchRoute } from "@/app/api/v1/listings/route";
import { GET as premiumRoute } from "@/app/api/v1/listings/premium/route";
import { GET as detailRoute } from "@/app/api/v1/listings/[publicId]/route";
import { GET as homeRoute } from "@/app/api/v1/home/route";

const SEARCH = "http://localhost/api/v1/listings";
const PREMIUM = "http://localhost/api/v1/listings/premium";
const HOME = "http://localhost/api/v1/home";

let storage: MemoryStorageProvider;
let ownerId = "";
let carCat = "";
let motoCat = "";
let brandA = ""; let brandB = ""; let motoBrand = "";
let modelA1 = ""; let modelA2 = ""; let modelB1 = ""; let motoModel = "";
let city1 = ""; let city2 = "";
let petrol = ""; let sedan = ""; let sport = "";
let featGlobal = ""; let featCar = "";
const created: Record<string, { id: string; publicId: string }> = {};

interface Spec {
  key: string;
  status?: string;
  category?: "CAR" | "MOTORCYCLE";
  brand?: string; model?: string; city?: string;
  price?: number; year?: number; mileage?: number;
  publishedOffsetMin?: number; // minutes ago
  expiresOffsetMin?: number;   // minutes from now (negative = already expired)
  fuel?: string; body?: string; moto?: string;
  credit?: boolean; barter?: boolean;
  features?: string[];
  image?: boolean;
}

async function insertListing(spec: Spec) {
  const sql = getSql();
  const status = spec.status ?? "ACTIVE";
  const category = spec.category === "MOTORCYCLE" ? motoCat : carCat;
  const brand = spec.brand ?? (spec.category === "MOTORCYCLE" ? motoBrand : brandA);
  const model = spec.model ?? (spec.category === "MOTORCYCLE" ? motoModel : modelA1);
  const publishedOffset = spec.publishedOffsetMin ?? 60;
  const expiresOffset = spec.expiresOffsetMin ?? 60 * 24 * 20;
  const [row] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor, mileage,
      fuel_type_id, body_type_id, motorcycle_type_id, credit_available, barter_available,
      description, contact_phone_e164, status, submitted_at, published_at, current_expires_at, sold_at)
    values (${ownerId}, ${category}, ${brand}, ${model}, ${spec.city ?? city1},
      ${spec.year ?? 2020}, ${spec.price ?? 1000000}, ${spec.mileage ?? 50000},
      ${spec.fuel ?? null}, ${spec.body ?? null}, ${spec.moto ?? null},
      ${spec.credit ?? false}, ${spec.barter ?? false},
      'Təsvir', '+994501234567', ${status}::listing_status,
      ${status === "PENDING_MODERATION" ? sql`now()` : null},
      ${status === "DRAFT" || status === "PENDING_MODERATION" || status === "PAYMENT_REQUIRED" ? null : sql`now() - (${publishedOffset} || ' minutes')::interval`},
      ${status === "DRAFT" || status === "PENDING_MODERATION" || status === "PAYMENT_REQUIRED" ? null : sql`now() + (${expiresOffset} || ' minutes')::interval`},
      ${status === "SOLD" ? sql`now()` : null})
    returning id, public_id::text as public_id
  `;
  if (spec.image !== false) {
    await sql`
      insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${row.id}, ${`listings/${randomUUID()}.webp`}, 0, true, 'image/webp', 1000, 1600, 900),
             (${row.id}, ${`listings/${randomUUID()}.webp`}, 1, false, 'image/webp', 1000, 1600, 900)
    `;
  }
  for (const f of spec.features ?? []) {
    await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${f})`;
  }
  created[spec.key] = { id: row.id, publicId: row.public_id };
  return created[spec.key];
}

async function promote(listingId: string, type: "BOOST" | "PREMIUM", startOffsetMin: number, endOffsetMin: number, status = "ACTIVE") {
  const sql = getSql();
  const [pay] = await sql<{ id: string }[]>`
    insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status)
    values (${ownerId}, ${listingId}, ${type}::payment_type, 0, ${`promo:${listingId}:${type}:${startOffsetMin}:${endOffsetMin}`}, 'CREATED')
    returning id
  `;
  await sql`
    insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
    values (${listingId}, ${type}::promotion_type, ${pay.id},
      now() + (${startOffsetMin} || ' minutes')::interval, now() + (${endOffsetMin} || ' minutes')::interval,
      ${status}::promotion_status, 7, 0)
  `;
}

async function search(q: string) {
  const r = await api(searchRoute, "GET", `${SEARCH}?${q}`);
  return r;
}
function allIds(r: { body: { data?: Record<string, unknown> } }, key: "items" | "promoted" = "items") {
  return ((r.body.data?.[key] as { publicId: string }[]) ?? []).map((i) => i.publicId);
}
/** Other suites leave ACTIVE listings in the shared DB — assert on this file's fixtures only. */
function ids(r: { body: { data?: Record<string, unknown> } }, key: "items" | "promoted" = "items") {
  const mine = new Set(Object.values(created).map((c) => c.publicId));
  return allIds(r, key).filter((id) => mine.has(id));
}
/** Leak checks run over the FULL serialized body — including URLs. */
function fullJson(value: unknown): string {
  return JSON.stringify(value);
}
function cacheSeconds(r: { response: Response }): { maxAge: number; sMaxAge: number; raw: string } {
  const raw = r.response.headers.get("cache-control") ?? "";
  const m = /max-age=(\d+)/.exec(raw);
  const sm = /s-maxage=(\d+)/.exec(raw);
  return { maxAge: m ? Number(m[1]) : -1, sMaxAge: sm ? Number(sm[1]) : -1, raw };
}
function sameSet(a: string[], b: string[]) {
  expect([...a].sort()).toEqual([...b].sort());
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  ownerId = (await createTestUserSession("+994516000001")).userId;
  [carCat, motoCat] = (await sql<{ id: string; code: string }[]>`select id, code from categories where code in ('CAR','MOTORCYCLE') order by code`).map((r) => r.id);
  const b = async (name: string, slug: string, cat: string) => {
    const [r] = await sql<{ id: string }[]>`insert into brands (name, slug) values (${name}, ${slug}) returning id`;
    await sql`insert into brand_categories (brand_id, category_id) values (${r.id}, ${cat})`;
    return r.id;
  };
  brandA = await b("PmAudi", "pm-audi", carCat);
  brandB = await b("PmBmw", "pm-bmw", carCat);
  motoBrand = await b("PmKtm", "pm-ktm", motoCat);
  const m = async (brand: string, cat: string, name: string, slug: string) =>
    (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${cat}, ${name}, ${slug}) returning id`)[0].id;
  modelA1 = await m(brandA, carCat, "PmA4", "pm-a4");
  modelA2 = await m(brandA, carCat, "PmA6", "pm-a6");
  modelB1 = await m(brandB, carCat, "PmX3", "pm-x3");
  motoModel = await m(motoBrand, motoCat, "PmDuke", "pm-duke");
  city1 = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('PmBakı', 'pm-baki', 97) returning id`)[0].id;
  city2 = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('PmGəncə', 'pm-gence', 98) returning id`)[0].id;
  petrol = (await sql<{ id: string }[]>`select id from reference_options where group_code='FUEL_TYPE' and code='PETROL'`)[0].id;
  sedan = (await sql<{ id: string }[]>`select id from reference_options where group_code='BODY_TYPE' and code='SEDAN'`)[0].id;
  sport = (await sql<{ id: string }[]>`select id from reference_options where group_code='MOTORCYCLE_TYPE' and code='SPORT'`)[0].id;
  featGlobal = (await sql<{ id: string }[]>`insert into features (code, name_az) values ('PM_ABS', 'Pm ABS') returning id`)[0].id;
  featCar = (await sql<{ id: string }[]>`insert into features (code, name_az, category_id) values ('PM_AC', 'Pm AC', ${carCat}) returning id`)[0].id;

  // visibility matrix
  await insertListing({ key: "active1", price: 500000, year: 2015, mileage: 150000, publishedOffsetMin: 300, fuel: petrol, body: sedan, features: [featGlobal, featCar], credit: true });
  await insertListing({ key: "active2", price: 2000000, year: 2022, mileage: 10000, publishedOffsetMin: 200, model: modelA2, city: city2, barter: true, features: [featGlobal] });
  await insertListing({ key: "active3", brand: brandB, model: modelB1, price: 1200000, year: 2019, mileage: 80000, publishedOffsetMin: 100 });
  await insertListing({ key: "activeMoto", category: "MOTORCYCLE", price: 300000, year: 2021, mileage: 5000, publishedOffsetMin: 50, moto: sport });
  await insertListing({ key: "timeExpired", status: "ACTIVE", expiresOffsetMin: -5, publishedOffsetMin: 10 });
  await insertListing({ key: "pending", status: "PENDING_MODERATION" });
  await insertListing({ key: "payment", status: "PAYMENT_REQUIRED" });
  await insertListing({ key: "sold", status: "SOLD", publishedOffsetMin: 400 });
  await insertListing({ key: "expired", status: "EXPIRED", expiresOffsetMin: -1000, publishedOffsetMin: 50000 });
  await insertListing({ key: "suspended", status: "SUSPENDED" });
  await insertListing({ key: "deleted", status: "DELETED" });
  await insertListing({ key: "draft", status: "DRAFT" });
  await insertListing({ key: "recent", publishedOffsetMin: 5, price: 700000, year: 2018 });
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("public search — visibility & filters", () => {
  it("anonymous search returns only ACTIVE + unexpired listings", async () => {
    const r = await search("category=CAR&limit=48");
    expect(r.status).toBe(200);
    expect(r.response.headers.get("cache-control")).toMatch(/^public, max-age=\d+, s-maxage=\d+$/);
    expect(r.response.headers.get("cache-control")).not.toContain("stale-while-revalidate");
    const got = ids(r);
    for (const k of ["active1", "active2", "active3", "recent"]) expect(got).toContain(created[k].publicId);
    for (const k of ["timeExpired", "pending", "payment", "sold", "expired", "suspended", "deleted", "draft", "activeMoto"]) {
      expect(got).not.toContain(created[k].publicId);
    }
  });

  it("cards are purpose-built DTOs with signed primary image and no internals", async () => {
    const r = await search("category=CAR&limit=48");
    const mine = new Set(Object.values(created).map((c) => c.publicId));
    const card = (r.body.data?.items as Record<string, unknown>[]).find((c) => mine.has(c.publicId as string))!;
    expect(Object.keys(card).sort()).toEqual(["badges", "brand", "category", "city", "currency", "mileage", "model", "priceMinor", "primaryImageUrl", "publicId", "publishedAt", "year"]);
    expect(card.primaryImageUrl).toContain("memory://signed-read/");
    const raw = fullJson(r.body);
    expect(raw).not.toContain(ownerId);
    for (const c of Object.values(created)) expect(raw).not.toContain(c.id); // no listing UUIDs anywhere, URLs included
    expect(raw).not.toMatch(/storage_?path/);
    expect(raw).not.toContain("+99450");
  });

  it("requires a category and rejects malformed filters", async () => {
    expect((await search("")).body.error?.code).toBe("VALIDATION_ERROR");
    expect((await search("category=CAR&brand_id=nope")).body.error?.code).toBe("VALIDATION_ERROR");
    expect((await search("category=CAR&price_min=900&price_max=100")).body.error?.code).toBe("VALIDATION_ERROR");
    expect((await search("category=CAR&year_min=2020&year_max=2010")).body.error?.code).toBe("VALIDATION_ERROR");
    expect((await search("category=CAR&mileage_max=-1")).body.error?.code).toBe("VALIDATION_ERROR");
    expect((await search("category=CAR&sort=RANDOM")).body.error?.code).toBe("VALIDATION_ERROR");
    expect((await search("category=PLANE")).body.error?.code).toBe("CATALOG_INVALID_CATEGORY");
    expect((await search(`category=CAR&brand_id=${motoBrand}`)).body.error?.code).toBe("CATALOG_INVALID_BRAND");
    expect((await search(`category=CAR&brand_id=${brandA}&model_id=${modelB1}`)).body.error?.code).toBe("CATALOG_INVALID_BRAND");
    expect((await search(`category=CAR&motorcycle_type_id=${sport}`)).body.error?.code).toBe("CATALOG_INVALID_GROUP");
    expect((await search(`category=MOTORCYCLE&body_type_id=${sedan}`)).body.error?.code).toBe("CATALOG_INVALID_GROUP");
    expect((await search(`category=MOTORCYCLE&feature_ids=${featCar}`)).body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("applies brand/model/city/price/year/mileage/option/flag/feature filters", async () => {
    const p = (k: string) => created[k].publicId;
    expect(ids(await search(`category=CAR&brand_id=${brandB}`))).toEqual([p("active3")]);
    expect(ids(await search(`category=CAR&brand_id=${brandA}&model_id=${modelA2}`))).toEqual([p("active2")]);
    expect(ids(await search(`category=CAR&city_id=${city2}`))).toEqual([p("active2")]);
    sameSet(ids(await search("category=CAR&price_min=600000&price_max=1500000")), [p("active3"), p("recent")]);
    expect(ids(await search("category=CAR&year_min=2019&year_max=2020"))).toEqual([p("active3")]);
    expect(ids(await search("category=CAR&mileage_max=20000"))).toEqual([p("active2")]);
    expect(ids(await search(`category=CAR&fuel_type_id=${petrol}`))).toEqual([p("active1")]);
    expect(ids(await search(`category=CAR&body_type_id=${sedan}`))).toEqual([p("active1")]);
    expect(ids(await search("category=CAR&credit=true"))).toEqual([p("active1")]);
    expect(ids(await search("category=CAR&barter=true"))).toEqual([p("active2")]);
    sameSet(ids(await search(`category=CAR&feature_ids=${featGlobal}`)), [p("active1"), p("active2")]);
    expect(ids(await search(`category=CAR&feature_ids=${featGlobal},${featCar}`))).toEqual([p("active1")]);
    expect(ids(await search(`category=MOTORCYCLE&motorcycle_type_id=${sport}`))).toEqual([p("activeMoto")]);
  });
});

describe("query support", () => {
  it("ships the category+newest partial index used by the default sort", async () => {
    const sql = getSql();
    const rows = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes where indexname = 'listings_active_category_newest'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].indexdef).toContain("published_at DESC");
    expect(rows[0].indexdef).toContain("WHERE (status = 'ACTIVE'::listing_status)");
  });
});

describe("public search — sorting & cursor pagination", () => {
  it("sorts deterministically and paginates without duplicates or gaps", async () => {
    const full = ids(await search("category=CAR&limit=48"));
    expect(full[0]).toBe(created.recent.publicId); // newest first
    const priceAsc = ids(await search("category=CAR&sort=PRICE_ASC&limit=48"));
    expect(priceAsc[0]).toBe(created.active1.publicId);
    const priceDesc = ids(await search("category=CAR&sort=PRICE_DESC&limit=48"));
    expect(priceDesc[0]).toBe(created.active2.publicId);
    const yearDesc = ids(await search("category=CAR&sort=YEAR_DESC&limit=48"));
    expect(yearDesc[0]).toBe(created.active2.publicId);

    for (const sort of ["NEWEST", "PRICE_ASC", "PRICE_DESC", "YEAR_DESC"]) {
      const all = ids(await search(`category=CAR&sort=${sort}&limit=48`));
      const paged: string[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const r = await search(`category=CAR&sort=${sort}&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
        expect(r.status).toBe(200);
        paged.push(...ids(r));
        cursor = (r.body as { meta?: { next_cursor: string | null } }).meta?.next_cursor ?? null;
        guard += 1;
      } while (cursor !== null && guard < 50);
      expect(paged).toEqual(all);
    }
  });

  it("rejects invalid cursors safely", async () => {
    const r = await search("category=CAR&cursor=garbage");
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("VALIDATION_ERROR");
    const first = await search("category=CAR&limit=1");
    const cursor = (first.body as { meta?: { next_cursor: string } }).meta?.next_cursor as string;
    const wrongSort = await search(`category=CAR&sort=PRICE_ASC&cursor=${cursor}`);
    expect(wrongSort.body.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("Boost read placement", () => {
  it("promotes only valid, filter-matching boosts and dedupes from organic", async () => {
    const boosted = await insertListing({ key: "boostA", price: 1100000, year: 2017, publishedOffsetMin: 900, fuel: petrol });
    const boostedOther = await insertListing({ key: "boostB", brand: brandB, model: modelB1, price: 900000, publishedOffsetMin: 950 });
    const expiredBoost = await insertListing({ key: "boostExpired", publishedOffsetMin: 960 });
    const inactiveBoost = await insertListing({ key: "boostInactive", status: "SUSPENDED" });
    await promote(boosted.id, "BOOST", -60, 60);
    await promote(boostedOther.id, "BOOST", -60, 60);
    await promote(expiredBoost.id, "BOOST", -120, -60);
    await promote(inactiveBoost.id, "BOOST", -60, 60);
    // scheduled-but-due (status lag) counts; future-scheduled does not
    const due = await insertListing({ key: "boostDue", publishedOffsetMin: 970, price: 800000 });
    await promote(due.id, "BOOST", -5, 60, "SCHEDULED");
    const future = await insertListing({ key: "boostFuture", publishedOffsetMin: 980 });
    await promote(future.id, "BOOST", 30, 90, "SCHEDULED");

    const r = await search("category=CAR&limit=48");
    const promoted = ids(r, "promoted");
    sameSet(promoted, [boosted.publicId, boostedOther.publicId, due.publicId]);
    for (const p of promoted) expect(ids(r)).not.toContain(p); // dedupe in same response
    expect(promoted).not.toContain(expiredBoost.publicId);
    expect(promoted).not.toContain(inactiveBoost.publicId);
    expect(promoted).not.toContain(future.publicId);
    const badge = (r.body.data?.promoted as { badges: { boosted: boolean } }[])[0].badges.boosted;
    expect(badge).toBe(true);

    // brand filter: only matching boost promoted (never bypasses filters)
    expect(ids(await search(`category=CAR&brand_id=${brandB}`), "promoted")).toEqual([boostedOther.publicId]);
    expect(ids(await search(`category=CAR&fuel_type_id=${petrol}`), "promoted")).toEqual([boosted.publicId]);
    expect(ids(await search("category=CAR&price_max=100"), "promoted")).toEqual([]);
    expect(ids(await search("category=MOTORCYCLE"), "promoted")).toEqual([]); // category isolation

    // deterministic within the hour; not on later pages
    const again = await search("category=CAR&limit=48");
    expect(ids(again, "promoted")).toEqual(promoted);
    const page1 = await search("category=CAR&limit=1");
    const cursor = (page1.body as { meta?: { next_cursor: string } }).meta?.next_cursor as string;
    expect(ids(await search(`category=CAR&limit=1&cursor=${cursor}`), "promoted")).toEqual([]);
  });

  it("caps promoted results at the configured maximum slots with rotation", async () => {
    const sql = getSql();
    await sql`update system_settings set value = '2'::jsonb where key in ('boost.first_view_slots_desktop','boost.first_view_slots_tablet','boost.first_view_slots_mobile')`;
    try {
      const r = await search("category=CAR&limit=48");
      expect(allIds(r, "promoted").length).toBe(2);
      expect(allIds(await search("category=CAR&limit=48"), "promoted")).toEqual(allIds(r, "promoted"));
    } finally {
      await sql`update system_settings set value = '4'::jsonb where key = 'boost.first_view_slots_desktop'`;
      await sql`update system_settings set value = '3'::jsonb where key = 'boost.first_view_slots_tablet'`;
      await sql`update system_settings set value = '2'::jsonb where key = 'boost.first_view_slots_mobile'`;
    }
  });
});

describe("Premium feed & Home", () => {
  it("home reports the 24h activation count and a clean Premium zero state", async () => {
    const r = await api(homeRoute, "GET", HOME);
    expect(r.status).toBe(200);
    const home = r.body.data?.home as Record<string, unknown>;
    const sql = getSql();
    const [{ count }] = await sql<{ count: string }[]>`
      select count(*)::text as count from listings
      where status = 'ACTIVE' and current_expires_at > now() and published_at > now() - interval '24 hours'
    `;
    expect(home.newListingsLast24h).toBe(Number(count));
    expect((home.categories as unknown[]).length).toBe(2);
    expect((home.premium as { items: unknown[] }).items).toEqual([]);
    expect(Object.keys(home).sort()).toEqual(["categories", "newListingsLast24h", "premium"]); // no New-feed / Popular Brands
  });

  it("premium feed lists all current premium listings once, newest activation first, with cursor", async () => {
    const p1 = await insertListing({ key: "prem1", publishedOffsetMin: 2000 });
    const p2 = await insertListing({ key: "prem2", publishedOffsetMin: 2100 });
    const p3 = await insertListing({ key: "prem3", category: "MOTORCYCLE", publishedOffsetMin: 2200 });
    const expiredListing = await insertListing({ key: "premExpiredListing", expiresOffsetMin: -1 });
    const expiredPromo = await insertListing({ key: "premExpiredPromo" });
    await promote(p1.id, "PREMIUM", -300, 300);
    await promote(p1.id, "PREMIUM", -600, -300, "EXPIRED"); // historical adjacent record
    await promote(p2.id, "PREMIUM", -100, 500);
    await promote(p3.id, "PREMIUM", -200, 400);
    await promote(expiredListing.id, "PREMIUM", -100, 500);
    await promote(expiredPromo.id, "PREMIUM", -500, -100);
    await promote(p2.id, "BOOST", -10, 10); // Premium + Boost same listing

    const all = await api(premiumRoute, "GET", `${PREMIUM}?limit=48`);
    expect(ids(all)).toEqual([p2.publicId, p3.publicId, p1.publicId]); // newest current activation first, once each
    expect((all.body.data?.items as { badges: { premium: boolean; boosted: boolean } }[])[0].badges).toEqual({ premium: true, boosted: true });

    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const r = await api(premiumRoute, "GET", `${PREMIUM}?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      paged.push(...ids(r));
      cursor = (r.body as { meta?: { next_cursor: string | null } }).meta?.next_cursor ?? null;
    } while (cursor !== null && paged.length < 10);
    expect(paged).toEqual(ids(all));

    const home = await api(homeRoute, "GET", HOME);
    expect(((home.body.data?.home as { premium: { items: { publicId: string }[] } }).premium.items).map((i) => i.publicId)).toEqual(ids(all));
    // boosted premium listing still appears as Boost in search
    expect(ids(await search("category=CAR&limit=48"), "promoted")).toContain(p2.publicId);
  });
});

describe("public detail", () => {
  async function detail(publicId: string) {
    return api(detailRoute, "GET", `http://localhost/api/v1/listings/${publicId}`, { params: { publicId } });
  }

  it("returns the full contactable DTO for ACTIVE listings and counts views best-effort", async () => {
    const r = await detail(created.active1.publicId);
    expect(r.status).toBe(200);
    const d = r.body.data?.listing as Record<string, unknown>;
    expect(d).toMatchObject({ status: "ACTIVE", contactable: true, brand: "PmAudi", model: "PmA4", fuelType: "Benzin", bodyType: "Sedan", creditAvailable: true });
    expect((d.images as { url: string; isPrimary: boolean }[]).length).toBe(2);
    expect((d.images as { url: string; isPrimary: boolean }[])[0].isPrimary).toBe(true);
    expect((d.features as { code: string }[]).map((f) => f.code).sort()).toEqual(["PM_ABS", "PM_AC"]);
    expect((d.seller as { contactPhoneMasked: string }).contactPhoneMasked).toBe("+994•••••••67");
    const raw = fullJson(r.body);
    expect(raw).not.toContain(ownerId);
    expect(raw).not.toContain(created.active1.id);
    expect(raw).not.toContain("+994501234567");
    for (const img of d.images as { url: string }[]) {
      expect(img.url).not.toContain(ownerId);
      expect(img.url).not.toContain(created.active1.id);
    }
    expect(raw).not.toMatch(/storage_?path|payment|moderat|owner_id/i);
    const sql = getSql();
    const [stats] = await sql<{ view_count: string }[]>`select view_count::text as view_count from listing_stats where listing_id = ${created.active1.id}`;
    expect(Number(stats.view_count)).toBeGreaterThanOrEqual(1);
  });

  it("returns limited non-contactable views for SOLD, EXPIRED, and time-expired ACTIVE", async () => {
    for (const [key, status] of [["sold", "SOLD"], ["expired", "EXPIRED"], ["timeExpired", "EXPIRED"]] as const) {
      const r = await detail(created[key].publicId);
      expect(r.status).toBe(200);
      const d = r.body.data?.listing as Record<string, unknown>;
      expect(d.status).toBe(status);
      expect(d.contactable).toBe(false);
      expect(d.seller).toBeNull();
      expect(d.description).toBeNull();
      expect((d.images as unknown[]).length).toBe(1); // primary only
    }
  });

  it("hides SUSPENDED/DELETED/DRAFT/PAYMENT/PENDING listings and unknown ids behind 404", async () => {
    for (const key of ["suspended", "deleted", "draft", "payment", "pending"]) {
      const r = await detail(created[key].publicId);
      expect(r.status).toBe(404);
      expect(r.body.error?.code).toBe("LISTING_NOT_FOUND");
    }
    expect((await detail("999999999")).status).toBe(404);
    expect((await detail("abc")).status).toBe(404);
    expect((await detail(created.active1.id)).status).toBe(404); // UUID is not a public id
  });

  it("degrades gracefully when image signing fails", async () => {
    const original = storage.createSignedReadUrl;
    storage.createSignedReadUrl = async () => { throw new Error("provider down"); };
    try {
      const r = await search("category=CAR&limit=2");
      expect(r.status).toBe(200);
      expect((r.body.data?.items as { primaryImageUrl: string | null }[]).every((i) => i.primaryImageUrl === null)).toBe(true);
      expect(JSON.stringify(r.body)).not.toContain("provider down");
    } finally {
      storage.createSignedReadUrl = original;
    }
  });
});

describe("cache lifetime is bounded by business validity", () => {
  it("search cache cannot outlive the earliest listing or promotion deadline", async () => {
    const soon = await insertListing({ key: "expiresSoon", expiresOffsetMin: 0.33, publishedOffsetMin: 3000, price: 123456 }); // ~20s
    const r = await search("category=CAR&price_min=123456&price_max=123456");
    expect(ids(r)).toEqual([soon.publicId]);
    const { maxAge, sMaxAge, raw } = cacheSeconds(r);
    expect(raw).not.toContain("stale-while-revalidate");
    expect(sMaxAge).toBeGreaterThan(0);
    expect(sMaxAge).toBeLessThanOrEqual(20);
    expect(maxAge).toBeLessThanOrEqual(20);

    const boosted = await insertListing({ key: "boostEndsSoon", publishedOffsetMin: 3100, price: 654321 });
    await promote(boosted.id, "BOOST", -60, 0.17); // ends in ~10s
    const rb = await search("category=CAR&price_min=654321&price_max=654321");
    expect(ids(rb, "promoted")).toEqual([boosted.publicId]);
    expect(cacheSeconds(rb).sMaxAge).toBeLessThanOrEqual(10);

    // headroom everywhere → configured ceilings apply
    const far = await search(`category=CAR&brand_id=${brandB}`);
    expect(cacheSeconds(far).sMaxAge).toBeLessThanOrEqual(60);
  });

  it("premium and home caches cannot outlive the earliest premium/listing deadline", async () => {
    const prem = await insertListing({ key: "premEndsSoon", publishedOffsetMin: 3200 });
    await promote(prem.id, "PREMIUM", -60, 0.25); // ends in ~15s
    const feed = await api(premiumRoute, "GET", `${PREMIUM}?limit=48`);
    expect(ids(feed)).toContain(prem.publicId);
    expect(cacheSeconds(feed).sMaxAge).toBeLessThanOrEqual(15);
    const home = await api(homeRoute, "GET", HOME);
    expect(cacheSeconds(home).sMaxAge).toBeLessThanOrEqual(15);
  });

  it("detail cache is bounded by its own expiry; imminent expiry → no-store", async () => {
    const soon = await insertListing({ key: "detailExpiresSoon", expiresOffsetMin: 0.2, publishedOffsetMin: 3300 }); // ~12s
    const r = await api(detailRoute, "GET", `http://localhost/api/v1/listings/${soon.publicId}`, { params: { publicId: soon.publicId } });
    expect(cacheSeconds(r).sMaxAge).toBeLessThanOrEqual(12);
    const imminent = await insertListing({ key: "detailImminent", expiresOffsetMin: 0.01, publishedOffsetMin: 3400 }); // ~0.6s
    const ri = await api(detailRoute, "GET", `http://localhost/api/v1/listings/${imminent.publicId}`, { params: { publicId: imminent.publicId } });
    expect(ri.response.headers.get("cache-control")).toBe("no-store");
  });

  it("an ACTIVE listing crossing current_expires_at stops being publicly valid", async () => {
    const crossing = await insertListing({ key: "crossing", expiresOffsetMin: 0.02, publishedOffsetMin: 3500, price: 777777 }); // ~1.2s
    expect(ids(await search("category=CAR&price_min=777777&price_max=777777"))).toEqual([crossing.publicId]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(ids(await search("category=CAR&price_min=777777&price_max=777777"))).toEqual([]);
    const d = await api(detailRoute, "GET", `http://localhost/api/v1/listings/${crossing.publicId}`, { params: { publicId: crossing.publicId } });
    const listing = d.body.data?.listing as { status: string; contactable: boolean };
    expect(listing.status).toBe("EXPIRED");
    expect(listing.contactable).toBe(false);
    // SOLD/SUSPENDED/DELETED semantics unchanged
    expect(((await api(detailRoute, "GET", `http://localhost/api/v1/listings/${created.sold.publicId}`, { params: { publicId: created.sold.publicId } })).body.data?.listing as { status: string }).status).toBe("SOLD");
    expect((await api(detailRoute, "GET", `http://localhost/api/v1/listings/${created.suspended.publicId}`, { params: { publicId: created.suspended.publicId } })).status).toBe(404);
    expect((await api(detailRoute, "GET", `http://localhost/api/v1/listings/${created.deleted.publicId}`, { params: { publicId: created.deleted.publicId } })).status).toBe(404);
  });
});
