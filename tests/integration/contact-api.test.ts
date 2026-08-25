import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { POST as contactRoute } from "@/app/api/v1/listings/[publicId]/contact/route";
import { api } from "./helpers/listing";
import { createTestUserSession } from "./helpers/session";

const SELLER_ACCOUNT_PHONE = "+994517770001";
const LISTING_CONTACT_PHONE = "+994557654321";

let sellerId = "";
let carCat = "";
const listings: Record<string, { id: string; publicId: string }> = {};

async function insertListing(key: string, opts: { status?: string; expired?: boolean; contact?: string | null } = {}) {
  const sql = getSql();
  const status = opts.status ?? "ACTIVE";
  const [row] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, status, year, price_minor, mileage, contact_phone_e164, published_at, current_expires_at, sold_at, submitted_at)
    values (${sellerId}, ${carCat}, ${status}::listing_status, 2020, 1000000, 50000,
      ${opts.contact === null ? null : (opts.contact ?? LISTING_CONTACT_PHONE)},
      now() - interval '1 day',
      ${opts.expired ? sql`now() - interval '1 minute'` : sql`now() + interval '10 days'`},
      ${status === "SOLD" ? sql`now()` : null}, now())
    returning id, public_id::text as public_id
  `;
  listings[key] = { id: row.id, publicId: row.public_id };
  return listings[key];
}

async function reveal(publicId: string, ip?: string) {
  return api(contactRoute, "POST", `http://localhost/api/v1/listings/${publicId}/contact`, {
    params: { publicId },
    ...(ip === undefined ? {} : { headers: { "x-forwarded-for": ip } }),
  } as never);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  sellerId = (await createTestUserSession(SELLER_ACCOUNT_PHONE)).userId;
  carCat = (await getSql()<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  await insertListing("active");
  await insertListing("sold", { status: "SOLD" });
  await insertListing("expired", { status: "EXPIRED", expired: true });
  await insertListing("timeExpired", { status: "ACTIVE", expired: true });
  await insertListing("pending", { status: "PENDING_MODERATION" });
  await insertListing("suspended", { status: "SUSPENDED" });
  await insertListing("noContact", { contact: null });
});

afterAll(async () => {
  await closeSql();
});

describe("POST /listings/:publicId/contact — privacy", () => {
  it("reveals the LISTING phone (never the account phone) with no-store", async () => {
    const r = await reveal(listings.active.publicId, "203.0.113.10");
    expect(r.status).toBe(200);
    const contact = r.body.data?.contact as { phone: string; whatsappUrl: string };
    expect(contact.phone).toBe(LISTING_CONTACT_PHONE);
    expect(contact.whatsappUrl).toBe(`https://wa.me/${LISTING_CONTACT_PHONE.slice(1)}`);
    expect(JSON.stringify(r.body)).not.toContain(SELLER_ACCOUNT_PHONE);
    expect(r.response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses every non-current or private state and missing contact", async () => {
    for (const key of ["sold", "expired", "timeExpired", "pending", "suspended"]) {
      const r = await reveal(listings[key].publicId, "203.0.113.11");
      expect(r.status, key).toBe(404);
      expect(r.body.error?.code).toBe("LISTING_NOT_FOUND");
    }
    const none = await reveal(listings.noContact.publicId, "203.0.113.11");
    expect(none.status).toBe(409);
    expect(none.body.error?.code).toBe("LISTING_CONTACT_UNAVAILABLE");
  });
});

describe("contact reveal rate limiting", () => {
  it("limits repeated reveals of the SAME listing per source with Retry-After", async () => {
    const ip = "198.51.100.201";
    for (let i = 0; i < 3; i += 1) {
      expect((await reveal(listings.active.publicId, ip)).status).toBe(200);
    }
    const limited = await reveal(listings.active.publicId, ip);
    expect(limited.status).toBe(429);
    expect(limited.body.error?.code).toBe("CONTACT_RATE_LIMITED");
    expect(Number(limited.response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(JSON.stringify(limited.body)).not.toMatch(/source_hash|anonymous_action|sql/i);
  });

  it("limits many-listing reveals from one source; other sources stay independent", async () => {
    const sql = getSql();
    const ip = "198.51.100.202";
    const targets: string[] = [];
    for (let i = 0; i < 6; i += 1) targets.push((await insertListing(`bulk${i}`)).publicId);
    const saved = process.env.CONTACT_REVEAL_PER_SOURCE_PER_WINDOW;
    process.env.CONTACT_REVEAL_PER_SOURCE_PER_WINDOW = "5";
    try {
      for (let i = 0; i < 5; i += 1) {
        expect((await reveal(targets[i], ip)).status).toBe(200);
      }
      const limited = await reveal(targets[5], ip);
      expect(limited.status).toBe(429);
      expect(limited.body.error?.code).toBe("CONTACT_RATE_LIMITED");
      // an unrelated source is unaffected
      expect((await reveal(targets[5], "198.51.100.203")).status).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.CONTACT_REVEAL_PER_SOURCE_PER_WINDOW;
      else process.env.CONTACT_REVEAL_PER_SOURCE_PER_WINDOW = saved;
    }
    // events fall out of the window without any cleanup job (no sleeps: rewind timestamps)
    await sql`update anonymous_action_events set created_at = created_at - interval '2 hours'`;
    expect((await reveal(listings.active.publicId, "198.51.100.201")).status).toBe(200);
  });

  it("persists only keyed hashes — never a raw IP", async () => {
    const sql = getSql();
    const rows = await sql<{ source_hash: string }[]>`select source_hash from anonymous_action_events`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.source_hash).not.toContain("198.51");
      expect(row.source_hash).not.toContain("203.0");
    }
    const raw = await sql`select 1 from anonymous_action_events where source_hash like '%.%'`;
    expect(raw.length).toBe(0);
  });

  it("skips limiting only when no trusted client IP exists (documented dev behavior)", async () => {
    const fresh = await insertListing("nolimit");
    for (let i = 0; i < 5; i += 1) {
      expect((await reveal(fresh.publicId)).status).toBe(200);
    }
  });
});
