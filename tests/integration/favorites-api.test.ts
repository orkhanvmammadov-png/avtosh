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
import { GET as listRoute } from "@/app/api/v1/me/favorites/route";
import { GET as idsRoute } from "@/app/api/v1/me/favorites/ids/route";
import {
  PUT as putRoute,
  DELETE as deleteRoute,
} from "@/app/api/v1/me/favorites/[publicId]/route";

const LIST = "http://localhost/api/v1/me/favorites";
const IDS = "http://localhost/api/v1/me/favorites/ids";
const item = (publicId: string) =>
  `http://localhost/api/v1/me/favorites/${publicId}`;

let storage: MemoryStorageProvider;
let sellerId = "";
let buyer: { userId: string; cookie: string };
let otherBuyer: { userId: string; cookie: string };
let carCat = "";
let brandId = "";
let modelId = "";
let cityId = "";
const created: Record<string, { id: string; publicId: string }> = {};

async function insertListing(
  key: string,
  options: { status?: string; expiresOffsetMin?: number; image?: boolean } = {},
) {
  const sql = getSql();
  const status = options.status ?? "ACTIVE";
  const hidden = ["DRAFT", "PENDING_MODERATION", "PAYMENT_REQUIRED"].includes(status);
  const expiresOffset = options.expiresOffsetMin ?? 60 * 24 * 20;
  const [row] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year,
      price_minor, mileage, description, contact_phone_e164, status,
      published_at, current_expires_at, sold_at)
    values (${sellerId}, ${carCat}, ${brandId}, ${modelId}, ${cityId}, 2021,
      1500000, 42000, 'Təsvir', '+994501234567', ${status}::listing_status,
      ${hidden ? null : sql`now() - interval '1 hour'`},
      ${hidden ? null : sql`now() + (${expiresOffset} || ' minutes')::interval`},
      ${status === "SOLD" ? sql`now()` : null})
    returning id, public_id::text as public_id
  `;
  if (options.image !== false) {
    await sql`
      insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${row.id}, ${`listings/${randomUUID()}.webp`}, 0, true, 'image/webp', 1000, 1600, 900)
    `;
  }
  created[key] = { id: row.id, publicId: row.public_id };
  return created[key];
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  sellerId = (await createTestUserSession("+994517000001")).userId;
  buyer = await createTestUserSession("+994517000002");
  otherBuyer = await createTestUserSession("+994517000003");
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brandId = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('FavToyota', 'fav-toyota') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brandId}, ${carCat})`;
  modelId = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brandId}, ${carCat}, 'FavCorolla', 'fav-corolla') returning id`)[0].id;
  cityId = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('FavBakı', 'fav-baki', 99) returning id`)[0].id;

  await insertListing("active");
  await insertListing("activeNoImage", { image: false });
  await insertListing("willDeactivate");
  await insertListing("draft", { status: "DRAFT" });
  await insertListing("sold", { status: "SOLD" });
  await insertListing("timeExpired", { expiresOffsetMin: -5 });
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("favorites — authentication and CSRF boundaries", () => {
  it("rejects every endpoint without a session", async () => {
    const p = created.active.publicId;
    for (const [route, method, url] of [
      [listRoute, "GET", LIST],
      [idsRoute, "GET", IDS],
      [putRoute, "PUT", item(p)],
      [deleteRoute, "DELETE", item(p)],
    ] as const) {
      const r = await api(route, method, url, { params: { publicId: p } });
      expect(r.status).toBe(401);
      expect(r.body.error?.code).toBe("AUTH_REQUIRED");
    }
  });

  it("rejects cross-origin mutations with FORBIDDEN_ORIGIN", async () => {
    const p = created.active.publicId;
    for (const [route, method] of [
      [putRoute, "PUT"],
      [deleteRoute, "DELETE"],
    ] as const) {
      const r = await api(route, method, item(p), {
        cookie: buyer.cookie,
        params: { publicId: p },
        origin: "https://evil.example",
      });
      expect(r.status).toBe(403);
      expect(r.body.error?.code).toBe("FORBIDDEN_ORIGIN");
    }
  });

  it("accepts same-origin mutations", async () => {
    const p = created.active.publicId;
    const r = await api(putRoute, "PUT", item(p), {
      cookie: buyer.cookie,
      params: { publicId: p },
      origin: "http://localhost",
    });
    expect(r.status).toBe(200);
    // cleanup so later tests build their own state explicitly
    await api(deleteRoute, "DELETE", item(p), { cookie: buyer.cookie, params: { publicId: p } });
  });
});

describe("favorites — add visibility rules", () => {
  it("favoriting a visible ACTIVE listing succeeds and is idempotent", async () => {
    const p = created.active.publicId;
    const first = await api(putRoute, "PUT", item(p), { cookie: buyer.cookie, params: { publicId: p } });
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ favorited: true });
    const again = await api(putRoute, "PUT", item(p), { cookie: buyer.cookie, params: { publicId: p } });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ favorited: true });
    const sql = getSql();
    const rows = await sql`select 1 from favorites where user_id = ${buyer.userId} and listing_id = ${created.active.id}`;
    expect(rows.length).toBe(1);
  });

  it.each(["draft", "sold", "timeExpired"])(
    "favoriting a hidden listing (%s) returns 404 without leaking existence",
    async (key) => {
      const p = created[key].publicId;
      const r = await api(putRoute, "PUT", item(p), { cookie: buyer.cookie, params: { publicId: p } });
      expect(r.status).toBe(404);
      expect(r.body.error?.code).toBe("LISTING_NOT_FOUND");
    },
  );

  it("nonexistent and malformed public ids both return the same 404", async () => {
    for (const publicId of ["999999999", "abc", "1e5", "-4"]) {
      const r = await api(putRoute, "PUT", item(publicId), { cookie: buyer.cookie, params: { publicId } });
      expect(r.status).toBe(404);
      expect(r.body.error?.code).toBe("LISTING_NOT_FOUND");
    }
  });
});

describe("favorites — listing and state transitions", () => {
  it("ids endpoint reflects the exact favorite set", async () => {
    const p2 = created.activeNoImage.publicId;
    await api(putRoute, "PUT", item(p2), { cookie: buyer.cookie, params: { publicId: p2 } });
    const r = await api(idsRoute, "GET", IDS, { cookie: buyer.cookie });
    expect(r.status).toBe(200);
    const ids = r.body.data?.publicIds as string[];
    expect(ids).toContain(created.active.publicId);
    expect(ids).toContain(p2);
    expect(r.response.headers.get("cache-control")).toContain("no-store");
  });

  it("list returns cards with public fields only — no internal UUIDs or seller identity", async () => {
    const r = await api(listRoute, "GET", LIST, { cookie: buyer.cookie });
    expect(r.status).toBe(200);
    const items = r.body.data?.items as Record<string, unknown>[];
    const card = items.find((i) => i.publicId === created.active.publicId)!;
    expect(card).toBeDefined();
    expect(card.brand).toBe("FavToyota");
    expect(card.model).toBe("FavCorolla");
    expect(card.priceMinor).toBe(1500000);
    expect(card.city).toBe("FavBakı");
    expect(card.isActive).toBe(true);
    expect(typeof card.primaryImageUrl).toBe("string");
    const serialized = JSON.stringify(r.body);
    expect(serialized).not.toContain(created.active.id);
    expect(serialized).not.toContain(buyer.userId);
    expect(serialized).not.toContain(sellerId);
    expect(serialized).not.toContain("+99450");
  });

  it("a favorited listing that leaves the marketplace stays listed, flagged inactive, without a signed image", async () => {
    const p = created.willDeactivate.publicId;
    await api(putRoute, "PUT", item(p), { cookie: buyer.cookie, params: { publicId: p } });
    const sql = getSql();
    await sql`update listings set status = 'SOLD', sold_at = now() where id = ${created.willDeactivate.id}`;
    const r = await api(listRoute, "GET", LIST, { cookie: buyer.cookie });
    const card = (r.body.data?.items as Record<string, unknown>[]).find((i) => i.publicId === p)!;
    expect(card.isActive).toBe(false);
    expect(card.primaryImageUrl).toBeNull();
  });

  it("removal works even for no-longer-visible listings and is idempotent", async () => {
    const p = created.willDeactivate.publicId;
    const first = await api(deleteRoute, "DELETE", item(p), { cookie: buyer.cookie, params: { publicId: p } });
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ favorited: false });
    const again = await api(deleteRoute, "DELETE", item(p), { cookie: buyer.cookie, params: { publicId: p } });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ favorited: false });
    const r = await api(idsRoute, "GET", IDS, { cookie: buyer.cookie });
    expect(r.body.data?.publicIds as string[]).not.toContain(p);
  });

  it("favorites are strictly per-user", async () => {
    const r = await api(listRoute, "GET", LIST, { cookie: otherBuyer.cookie });
    expect(r.status).toBe(200);
    expect(r.body.data?.items).toEqual([]);
    const ids = await api(idsRoute, "GET", IDS, { cookie: otherBuyer.cookie });
    expect(ids.body.data?.publicIds).toEqual([]);
  });

  it("cards are ordered by most recently favorited first", async () => {
    const a = created.activeNoImage.publicId;
    const b = created.active.publicId;
    // re-favoriting does not bump order (idempotent no-op keeps created_at)
    await api(putRoute, "PUT", item(b), { cookie: buyer.cookie, params: { publicId: b } });
    const r = await api(listRoute, "GET", LIST, { cookie: buyer.cookie });
    const order = (r.body.data?.items as { publicId: string }[]).map((i) => i.publicId);
    expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
  });
});
