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
import { createTestUserSession } from "./helpers/session";

/**
 * O.12 Stage E — reference-checking image orphan cleanup. Candidates
 * are hints; the worker's execution-time reference check plus the
 * grace interval are the only deletion authority. Grace and event age
 * are controlled through the DB clock (created_at), never sleeps.
 */

let storage: MemoryStorageProvider;
let seller: { userId: string };
let carCat: string;
const BUCKET = () => listingImageConfig().imagesBucket;

async function insertListing(): Promise<string> {
  const sql = getSql();
  const [row] = await sql<{ id: string }[]>`
    insert into listings (owner_id, category_id, status, published_at, current_expires_at)
    values (${seller.userId}, ${carCat}, 'ACTIVE', now() - interval '1 day', now() + interval '20 days')
    returning id
  `;
  return row.id;
}

function putObject(path: string): void {
  storage.objects.set(`${BUCKET()}/${path}`, { data: Buffer.from("x"), contentType: "image/webp" });
}

async function referenceApproved(listingId: string, path: string): Promise<void> {
  const sql = getSql();
  await sql`
    insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes)
    values (${listingId}, ${path}, (select coalesce(max(sort_order),-1)+1 from listing_images where listing_id = ${listingId}), false, 'image/webp', 100)
  `;
}

async function referenceStaged(listingId: string, path: string): Promise<string> {
  const sql = getSql();
  const [rev] = await sql<{ id: string }[]>`
    insert into listing_edit_revisions (listing_id, status, data, decided_at)
    values (${listingId}, 'CANCELLED', '{}'::jsonb, now())
    returning id
  `;
  await sql`
    insert into listing_edit_images (edit_revision_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes)
    values (${rev.id}, ${path}, 0, false, 'image/webp', 100)
  `;
  return rev.id;
}

/** Emit a candidate event aged past (or inside) the grace window. */
async function emitCandidate(
  listingId: string,
  paths: string[],
  options: { ageSeconds?: number } = {},
): Promise<string> {
  const sql = getSql();
  const age = options.ageSeconds ?? 7200;
  const [row] = await sql<{ id: string }[]>`
    insert into outbox_events (event_type, aggregate_type, aggregate_id, payload, created_at)
    values ('LISTING_EDIT_CANCELLED', 'listing', ${listingId},
      ${sql.json({ listing_id: listingId, cleanup_candidate_paths: paths.join(",") })},
      now() - (${age} || ' seconds')::interval)
    returning id
  `;
  return row.id;
}

async function eventState(id: string): Promise<{ status: string; attempts: number }> {
  const sql = getSql();
  const [row] = await sql<{ status: string; attempt_count: number }[]>`
    select status::text as status, attempt_count from outbox_events where id = ${id}
  `;
  return { status: row.status, attempts: row.attempt_count };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  seller = await createTestUserSession("+994516300001");
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("image cleanup worker", () => {
  it("retained moderation-adjustment snapshots protect their submitted image paths (O.13)", async () => {
    const sql = getSql();
    const listing = await insertListing();
    const paths = {
      OPEN: `listings/${randomUUID()}.webp`,
      APPLIED: `listings/${randomUUID()}.webp`,
      DISCARDED: `listings/${randomUUID()}.webp`,
    } as const;
    const orphanPath = `listings/${randomUUID()}.webp`;
    for (const path of [...Object.values(paths), orphanPath]) putObject(path);
    // one retained adjustment row per lifecycle state, each freezing
    // exactly one submitted image path (sealed O.13.2: OPEN, APPLIED
    // and DISCARDED history rows are all intentional references)
    for (const [status, path] of Object.entries(paths)) {
      await sql`
        insert into moderation_adjustments
          (listing_id, status, submitted_listing_revision, submitted_data,
           submitted_images, adjusted_data, image_plan, moderator_id,
           discarded_at, applied_at)
        values
          (${listing}, ${status}::moderation_adjustment_status, 1, '{}'::jsonb,
           ${sql.json([{ source_id: randomUUID(), storage_path: path, sort_order: 0, is_primary: true, width: null, height: null, mime_type: "image/webp" }])},
           '{}'::jsonb, '[]'::jsonb, ${seller.userId},
           ${status === "DISCARDED" ? sql`now()` : null},
           ${status === "APPLIED" ? sql`now()` : null})
      `;
    }
    const event = await emitCandidate(listing, [...Object.values(paths), orphanPath]);
    const summary = await runImageCleanup({ graceSeconds: 3600 });
    expect(summary.events).toBeGreaterThanOrEqual(1);
    expect(storage.has(BUCKET(), paths.OPEN)).toBe(true); // history-protected
    expect(storage.has(BUCKET(), paths.APPLIED)).toBe(true); // history-protected
    expect(storage.has(BUCKET(), paths.DISCARDED)).toBe(true); // history-protected
    expect(storage.has(BUCKET(), orphanPath)).toBe(false); // true orphan → deleted
    expect((await eventState(event)).status).toBe("PROCESSED");
  });

  it("deletes only true orphans; every live reference wins", async () => {
    const listing = await insertListing();
    const approvedPath = `listings/${randomUUID()}.webp`;
    const sharedPath = `listings/${randomUUID()}.webp`;
    const stagedOnlyPath = `listings/${randomUUID()}.webp`;
    const orphanPath = `listings/${randomUUID()}.webp`;
    for (const path of [approvedPath, sharedPath, stagedOnlyPath, orphanPath]) putObject(path);

    await referenceApproved(listing, approvedPath); // public gallery
    await referenceApproved(listing, sharedPath); // shared with staging
    await referenceStaged(listing, sharedPath);
    await referenceStaged(listing, stagedOnlyPath); // retained history row

    const event = await emitCandidate(listing, [approvedPath, sharedPath, stagedOnlyPath, orphanPath]);
    const summary = await runImageCleanup({ graceSeconds: 3600 });
    expect(summary.events).toBeGreaterThanOrEqual(1);

    expect(storage.has(BUCKET(), approvedPath)).toBe(true); // approved → never
    expect(storage.has(BUCKET(), sharedPath)).toBe(true); // shared → never
    expect(storage.has(BUCKET(), stagedOnlyPath)).toBe(true); // history row → retained
    expect(storage.has(BUCKET(), orphanPath)).toBe(false); // true orphan → deleted
    expect((await eventState(event)).status).toBe("PROCESSED");
  });

  it("grace period: a fresh candidate is untouched until the interval passes", async () => {
    const listing = await insertListing();
    const path = `listings/${randomUUID()}.webp`;
    putObject(path);
    const event = await emitCandidate(listing, [path], { ageSeconds: 60 }); // inside grace
    await runImageCleanup({ graceSeconds: 3600 });
    expect(storage.has(BUCKET(), path)).toBe(true);
    expect((await eventState(event)).status).toBe("PENDING"); // not claimed yet
    // age the event past the grace window via the DB clock — no sleeps
    const sql = getSql();
    await sql`update outbox_events set created_at = now() - interval '2 hours' where id = ${event}`;
    await runImageCleanup({ graceSeconds: 3600 });
    expect(storage.has(BUCKET(), path)).toBe(false);
    expect((await eventState(event)).status).toBe("PROCESSED");
  });

  it("duplicate candidates converge on one safe end state", async () => {
    const listing = await insertListing();
    const path = `listings/${randomUUID()}.webp`;
    putObject(path);
    const eventA = await emitCandidate(listing, [path]);
    const eventB = await emitCandidate(listing, [path]);
    const summary = await runImageCleanup({ graceSeconds: 3600 });
    expect(summary.deleted).toBeGreaterThanOrEqual(1);
    expect(storage.has(BUCKET(), path)).toBe(false);
    expect((await eventState(eventA)).status).toBe("PROCESSED");
    expect((await eventState(eventB)).status).toBe("PROCESSED"); // idempotent second delete
    // a re-run changes nothing
    const again = await runImageCleanup({ graceSeconds: 3600 });
    expect(again.events).toBe(0);
  });

  it("a candidate re-referenced before execution is never deleted", async () => {
    const listing = await insertListing();
    const path = `listings/${randomUUID()}.webp`;
    putObject(path);
    const event = await emitCandidate(listing, [path]);
    // between emission and execution the object becomes approved again
    // (e.g. a later approval republished the same storage path)
    await referenceApproved(listing, path);
    const summary = await runImageCleanup({ graceSeconds: 3600 });
    expect(summary.retained).toBeGreaterThanOrEqual(1);
    expect(storage.has(BUCKET(), path)).toBe(true);
    expect((await eventState(event)).status).toBe("PROCESSED"); // terminal, correct
  });

  it("storage failure: business data intact, event retries with backoff, then succeeds", async () => {
    const listing = await insertListing();
    const path = `listings/${randomUUID()}.webp`;
    putObject(path);
    const event = await emitCandidate(listing, [path]);
    // wrap the provider with a failing deleteObject for ONE run
    const failing = {
      ...storage,
      deleteObject: async () => {
        throw new Error("storage unavailable");
      },
    };
    setStorageProviderForTesting(failing as typeof storage);
    const failedRun = await runImageCleanup({ graceSeconds: 3600 });
    expect(failedRun.retried).toBeGreaterThanOrEqual(1);
    const afterFail = await eventState(event);
    expect(afterFail.status).toBe("PENDING"); // retry-compatible
    expect(afterFail.attempts).toBe(1);
    expect(storage.has(BUCKET(), path)).toBe(true); // nothing corrupted
    // restore the provider; make the retry due NOW via the DB clock
    setStorageProviderForTesting(storage);
    const sql = getSql();
    await sql`update outbox_events set available_at = now() where id = ${event}`;
    await runImageCleanup({ graceSeconds: 3600 });
    expect(storage.has(BUCKET(), path)).toBe(false);
    expect((await eventState(event)).status).toBe("PROCESSED");
  });
});
