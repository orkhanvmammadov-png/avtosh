import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { adminReports } from "@/services/admin";
import { createTestUserSession } from "./helpers/session";
import { api, withEnv } from "./helpers/listing";
import { POST as reportRoute } from "@/app/api/v1/listings/[publicId]/report/route";

/**
 * Phase 4.16 report intake: anonymous buyer reports over the accepted
 * anonymous_action_events abuse infrastructure, uniform 404s (no
 * hidden-listing oracle), no reporter/report-id leakage, and the
 * Phase 4.15 admin round-trip.
 */

let seller: { userId: string };
let carCat = "";

const url = (publicId: string) => `http://localhost/api/v1/listings/${publicId}/report`;

async function insertListing(status: string): Promise<{ id: string; publicId: string }> {
  const sql = getSql();
  const published = ["ACTIVE", "SOLD", "EXPIRED", "SUSPENDED"].includes(status);
  const [row] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, status, published_at, current_expires_at)
    values (${seller.userId}, ${carCat}, ${status}::listing_status,
      ${published ? sql`now() - interval '1 day'` : null},
      ${published ? sql`now() + interval '20 days'` : null})
    returning id, public_id::text as public_id
  `;
  return { id: row.id, publicId: row.public_id };
}

async function report(
  publicId: string,
  body: unknown,
  ip?: string,
) {
  return api(reportRoute, "POST", url(publicId), {
    params: { publicId },
    body,
    ...(ip === undefined ? {} : { headers: { "x-forwarded-for": ip } }),
  });
}

async function reportRows(listingId: string) {
  const sql = getSql();
  return sql<{ reason_code: string; note: string | null; status: string }[]>`
    select reason_code, note, status::text as status
    from listing_reports where listing_id = ${listingId}
  `;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  const sql = getSql();
  seller = await createTestUserSession("+994526000001");
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
});

afterAll(async () => {
  await closeSql();
});

describe("report intake", () => {
  it("accepts a report for a public listing, stores it OPEN, and leaks nothing back", async () => {
    const listing = await insertListing("ACTIVE");
    const hostileNote = "<script>alert(1)</script> qiymət yalandır";
    const r = await report(listing.publicId, {
      reason_code: "WRONG_INFORMATION",
      note: hostileNote,
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ accepted: true }); // no id, no metadata
    const rows = await reportRows(listing.id);
    expect(rows).toEqual([
      { reason_code: "WRONG_INFORMATION", note: hostileNote, status: "OPEN" },
    ]);
    // the serialized response carries no report/reporter identifiers
    expect(JSON.stringify(r.body)).not.toContain(listing.id);
  });

  it("SOLD and EXPIRED (limited public views) are reportable; hidden statuses answer a uniform 404", async () => {
    const sold = await insertListing("SOLD");
    expect((await report(sold.publicId, { reason_code: "SOLD_OR_UNAVAILABLE" })).status).toBe(200);
    const expired = await insertListing("EXPIRED");
    expect((await report(expired.publicId, { reason_code: "OTHER" })).status).toBe(200);
    for (const status of ["SUSPENDED", "DRAFT", "PENDING_MODERATION", "REJECTED"]) {
      const hidden = await insertListing(status);
      const r = await report(hidden.publicId, { reason_code: "OTHER" });
      expect(r.status).toBe(404); // no hidden-listing oracle
      expect(r.body.error?.code).toBe("LISTING_NOT_FOUND");
      expect(await reportRows(hidden.id)).toHaveLength(0);
    }
    expect((await report("99999999", { reason_code: "OTHER" })).status).toBe(404);
    expect((await report("not-a-number", { reason_code: "OTHER" })).status).toBe(404);
  });

  it("rejects unknown reason codes, oversized notes, and extra fields", async () => {
    const listing = await insertListing("ACTIVE");
    expect((await report(listing.publicId, { reason_code: "MADE_UP" })).status).toBe(400);
    expect(
      (await report(listing.publicId, { reason_code: "OTHER", note: "x".repeat(501) })).status,
    ).toBe(400);
    expect(
      (await report(listing.publicId, { reason_code: "OTHER", reporter: "me" })).status,
    ).toBe(400);
    expect(await reportRows(listing.id)).toHaveLength(0);
  });

  it("rate-limits the same source per listing and overall (hashed IP, never raw)", async () => {
    await withEnv(
      { REPORT_PER_LISTING_PER_WINDOW: "1", REPORT_PER_SOURCE_PER_WINDOW: "3" },
      async () => {
        const sql = getSql();
        const ip = "198.51.100.77";
        const first = await insertListing("ACTIVE");
        expect((await report(first.publicId, { reason_code: "FRAUD_SUSPECTED" }, ip)).status).toBe(200);
        // same source, same listing → refused
        const repeat = await report(first.publicId, { reason_code: "OTHER" }, ip);
        expect(repeat.status).toBe(429);
        expect(repeat.body.error?.code).toBe("REPORT_RATE_LIMITED");
        expect(await reportRows(first.id)).toHaveLength(1);
        // a different source may still report the listing
        expect((await report(first.publicId, { reason_code: "OTHER" }, "198.51.100.78")).status).toBe(200);
        // mass reporting across listings hits the per-source cap
        const second = await insertListing("ACTIVE");
        const third = await insertListing("ACTIVE");
        const fourth = await insertListing("ACTIVE");
        expect((await report(second.publicId, { reason_code: "OTHER" }, ip)).status).toBe(200);
        expect((await report(third.publicId, { reason_code: "OTHER" }, ip)).status).toBe(200);
        const capped = await report(fourth.publicId, { reason_code: "OTHER" }, ip);
        expect(capped.status).toBe(429);
        expect(await reportRows(fourth.id)).toHaveLength(0);
        // raw IPs are never stored — only keyed hashes
        const [raw] = await sql<{ n: string }[]>`
          select count(*)::text as n from anonymous_action_events
          where action = 'LISTING_REPORT' and source_hash like '%198.51.100%'
        `;
        expect(Number(raw.n)).toBe(0);
      },
    );
  });

  it("reaches the Phase 4.15 admin queue as an OPEN report", async () => {
    const listing = await insertListing("ACTIVE");
    const marker = `admin-roundtrip-${randomUUID()}`;
    expect(
      (await report(listing.publicId, { reason_code: "DUPLICATE", note: marker })).status,
    ).toBe(200);
    const open = await adminReports({ status: "OPEN" });
    const row = open.items.find((item) => item.note === marker);
    expect(row).toBeDefined();
    expect(row!.listingId).toBe(listing.id);
    expect(row!.reasonCode).toBe("DUPLICATE");
  });
});
