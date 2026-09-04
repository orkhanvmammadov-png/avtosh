import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { createTestUserSession } from "./helpers/session";
import { api } from "./helpers/listing";
import { GET as searchRoute } from "@/app/api/v1/listings/route";

/**
 * Phase 4.17O.2 — advanced search contract (ephemeral PostgreSQL).
 * OR inside multi-select groups, AND across groups, positive-claim
 * condition semantics, engine range with NULL exclusion, legacy
 * singular-param compatibility, cursor/Boost invariants.
 */

const SEARCH = "http://localhost/api/v1/listings";

let ownerId = "";
let carCat = "";
let brand = "";
let model = "";
let city = "";
const fuel: Record<string, string> = {};
const trans: Record<string, string> = {};
const color: Record<string, string> = {};
const listings: Record<string, { id: string; publicId: string }> = {};

interface Spec {
  key: string;
  fuel?: string | null;
  trans?: string | null;
  color?: string | null;
  engineCc?: number | null;
  noAccident?: boolean | null;
  notRepainted?: boolean | null;
  year?: number;
}

async function insertListing(spec: Spec) {
  const sql = getSql();
  const [row] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor, mileage,
      fuel_type_id, transmission_id, color_id, engine_cc, no_accident, not_repainted,
      description, contact_phone_e164, status, published_at, current_expires_at)
    values (${ownerId}, ${carCat}, ${brand}, ${model}, ${city}, ${spec.year ?? 2020}, 1000000, 50000,
      ${spec.fuel ?? null}, ${spec.trans ?? null}, ${spec.color ?? null}, ${spec.engineCc ?? null},
      ${spec.noAccident ?? null}, ${spec.notRepainted ?? null},
      'Təsvir', '+994501234567', 'ACTIVE',
      now() - interval '1 hour', now() + interval '20 days')
    returning id, public_id::text as public_id
  `;
  listings[spec.key] = { id: row.id, publicId: row.public_id };
}

async function search(q: string): Promise<string[]> {
  const r = await api(searchRoute, "GET", `${SEARCH}?${q}`);
  expect(r.status).toBe(200);
  const data = r.body.data as { items: { publicId: string }[] };
  return data.items.map((i) => i.publicId);
}

function ids(...keys: string[]): string[] {
  return keys.map((k) => listings[k].publicId).sort();
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  const sql = getSql();
  ownerId = (await createTestUserSession("+994530000031")).userId;
  [{ id: carCat }] = await sql<{ id: string }[]>`select id from categories where code = 'CAR'`;
  const [b] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('AsvBrand', 'asv-brand') returning id`;
  brand = b.id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  const [m] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'AsvModel', 'asv-model') returning id`;
  model = m.id;
  const [c] = await sql<{ id: string }[]>`
    insert into cities (name_az, slug, sort_order) values ('AsvBakı', 'asv-baki', 96) returning id`;
  city = c.id;
  for (const [store, group, codes] of [
    [fuel, "FUEL_TYPE", ["PETROL", "DIESEL", "HYBRID"]],
    [trans, "TRANSMISSION", ["AUTOMATIC", "ROBOT", "MANUAL"]],
    [color, "COLOR", ["BLACK", "WHITE", "RED"]],
  ] as const) {
    for (const code of codes) {
      const [row] = await sql<{ id: string }[]>`
        select id from reference_options where group_code = ${group} and code = ${code}`;
      (store as Record<string, string>)[code] = row.id;
    }
  }

  // fixture matrix
  await insertListing({ key: "petrolAtBlack", fuel: fuel.PETROL, trans: trans.AUTOMATIC, color: color.BLACK, engineCc: 2000, noAccident: true, notRepainted: true });
  await insertListing({ key: "hybridRobotWhite", fuel: fuel.HYBRID, trans: trans.ROBOT, color: color.WHITE, engineCc: 1500, noAccident: true, notRepainted: null });
  await insertListing({ key: "dieselManualRed", fuel: fuel.DIESEL, trans: trans.MANUAL, color: color.RED, engineCc: 3000, noAccident: null, notRepainted: true });
  await insertListing({ key: "nullEverything", fuel: null, trans: null, color: null, engineCc: null, noAccident: null, notRepainted: null });
});

afterAll(async () => {
  const sql = getSql();
  for (const l of Object.values(listings)) {
    await sql`delete from listings where id = ${l.id}`;
  }
  await closeSql();
});

describe("multi-select OR semantics", () => {
  it("fuel: two selected values match either (OR inside the group)", async () => {
    const found = await search(`category=CAR&fuel_type_ids=${fuel.PETROL},${fuel.HYBRID}`);
    expect(found.sort()).toEqual(ids("petrolAtBlack", "hybridRobotWhite"));
  });
  it("transmission: OR inside the group", async () => {
    const found = await search(`category=CAR&transmission_ids=${trans.AUTOMATIC},${trans.ROBOT}`);
    expect(found.sort()).toEqual(ids("petrolAtBlack", "hybridRobotWhite"));
  });
  it("color: OR inside the group", async () => {
    const found = await search(`category=CAR&color_ids=${color.BLACK},${color.WHITE}`);
    expect(found.sort()).toEqual(ids("petrolAtBlack", "hybridRobotWhite"));
  });
  it("different groups AND-compose", async () => {
    const found = await search(
      `category=CAR&fuel_type_ids=${fuel.PETROL},${fuel.HYBRID}&transmission_ids=${trans.ROBOT}`,
    );
    expect(found).toEqual([listings.hybridRobotWhite.publicId]);
  });
  it("rejects an invalid option id for the category", async () => {
    const r = await api(searchRoute, "GET", `${SEARCH}?category=CAR&fuel_type_ids=${trans.MANUAL}`);
    expect(r.status).toBe(400);
  });
});

describe("legacy singular params", () => {
  it("singular fuel_type_id still works", async () => {
    const found = await search(`category=CAR&fuel_type_id=${fuel.DIESEL}`);
    expect(found).toEqual([listings.dieselManualRed.publicId]);
  });
  it("singular + plural merge into one deduplicated bucket", async () => {
    const found = await search(`category=CAR&fuel_type_id=${fuel.PETROL}&fuel_type_ids=${fuel.PETROL},${fuel.HYBRID}`);
    expect(found.sort()).toEqual(ids("petrolAtBlack", "hybridRobotWhite"));
  });
});

describe("vehicle condition (positive claims)", () => {
  it("single claim filters to explicit TRUE only (NULL never matches)", async () => {
    const found = await search("category=CAR&no_accident=true");
    expect(found.sort()).toEqual(ids("petrolAtBlack", "hybridRobotWhite"));
  });
  it("both claims AND-compose", async () => {
    const found = await search("category=CAR&no_accident=true&not_repainted=true");
    expect(found).toEqual([listings.petrolAtBlack.publicId]);
  });
  it("false is not a filter (absence of claim is never matched)", async () => {
    // identical result set with and without no_accident=false — the
    // param only ever filters on the positive claim
    const baseline = await search("category=CAR&limit=48");
    const found = await search("category=CAR&no_accident=false&limit=48");
    expect(found.sort()).toEqual(baseline.sort());
    for (const key of ["petrolAtBlack", "hybridRobotWhite", "dieselManualRed", "nullEverything"]) {
      expect(found).toContain(listings[key].publicId);
    }
  });
});

describe("engine displacement", () => {
  it("min bound", async () => {
    const found = await search("category=CAR&engine_cc_min=1800");
    expect(found.sort()).toEqual(ids("dieselManualRed", "petrolAtBlack"));
  });
  it("max bound", async () => {
    const found = await search("category=CAR&engine_cc_max=1600");
    expect(found).toEqual([listings.hybridRobotWhite.publicId]);
  });
  it("min+max window; NULL engine_cc is excluded from bounded searches", async () => {
    const found = await search("category=CAR&engine_cc_min=1000&engine_cc_max=16000");
    expect(found.sort()).toEqual(ids("dieselManualRed", "hybridRobotWhite", "petrolAtBlack"));
    expect(found).not.toContain(listings.nullEverything.publicId);
  });
  it("rejects min > max", async () => {
    const r = await api(searchRoute, "GET", `${SEARCH}?category=CAR&engine_cc_min=3000&engine_cc_max=1000`);
    expect(r.status).toBe(400);
  });
});

describe("year policy at the API boundary", () => {
  it("accepts the new maximum and rejects the obsolete 2100", async () => {
    const ok = await api(searchRoute, "GET", `${SEARCH}?category=CAR&year_max=2027`);
    expect(ok.status).toBe(200);
    const rejected = await api(searchRoute, "GET", `${SEARCH}?category=CAR&year_max=2100`);
    expect(rejected.status).toBe(400);
  });
});

describe("pagination invariants under multi-filters", () => {
  it("keyset cursor still paginates a multi-select search", async () => {
    const first = await api(searchRoute, "GET", `${SEARCH}?category=CAR&color_ids=${color.BLACK},${color.WHITE},${color.RED}&limit=2`);
    expect(first.status).toBe(200);
    const page1 = first.body.data as { items: { publicId: string }[] };
    const cursor = (first.body as { meta?: { next_cursor: string | null } }).meta?.next_cursor;
    expect(page1.items).toHaveLength(2);
    expect(cursor).toBeTruthy();
    const second = await api(searchRoute, "GET", `${SEARCH}?category=CAR&color_ids=${color.BLACK},${color.WHITE},${color.RED}&limit=2&cursor=${encodeURIComponent(cursor!)}`);
    expect(second.status).toBe(200);
    const page2 = second.body.data as { items: { publicId: string }[] };
    const all = [...page1.items, ...page2.items].map((i) => i.publicId);
    expect(new Set(all).size).toBe(3); // no duplicates across pages
    expect(all.sort()).toEqual(ids("dieselManualRed", "hybridRobotWhite", "petrolAtBlack"));
  });
});
