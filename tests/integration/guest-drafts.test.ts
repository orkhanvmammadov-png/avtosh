import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { generateSessionToken } from "@/auth/otp-crypto";
import { ApiError } from "@/lib/api/errors";
import { closeSql, getSql, withTransaction } from "@/lib/server/db/client";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import type { StorageProvider } from "@/providers/storage/types";
import {
  createGuestDraft,
  getGuestDraftDto,
  resolveGuestSession,
  updateGuestDraft,
} from "@/services/guest-drafts";
import { runGuestDraftCleanup } from "@/services/guest-draft-cleanup";
import { createDraft, getOwnedListingDto, updateDraft } from "@/services/listing-drafts";
import {
  GUEST_DRAFT_DELETED_EVENT,
  condemnExpiredGuestListing,
} from "@/repositories/guest-drafts";
import { insertOutboxEvent } from "@/repositories/listing-publications";
import type { AuthContext } from "@/auth/current-user";
import { createTestUserSession } from "./helpers/session";

/**
 * Guest draft foundation (deferred-login PR A): fail-closed flag,
 * database ownership CHECKs, capability scoping with expiry at query
 * time, session/IP caps, IDOR attempts, revision conflicts with the
 * shared catalog semantics, cleanup (storage before rows), and the
 * untouched authenticated seller path.
 */

let fixtures: { cat: string; moto: string; brand: string; model: string };
let seller: AuthContext;

const ENV_KEYS = [
  "GUEST_DRAFTS_ENABLED",
  "GUEST_SESSIONS_IP_MAX_PER_HOUR",
  "GUEST_DRAFTS_IP_MAX_PER_HOUR",
] as const;
const savedEnv: Record<string, string | undefined> = {};

async function expectApiError(
  run: () => Promise<unknown>,
  code: string,
): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    return error as ApiError;
  }
  throw new Error(`expected ApiError ${code}, but the call succeeded`);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The PR-C claim contract: ONE guarded transactional write on the
    listings row. Cleanup's condemn locks the same row, so these two
    can only serialize — never interleave against storage. */
async function simulateClaim(
  sql: Parameters<typeof condemnExpiredGuestListing>[0],
  listingId: string,
  sessionId: string,
  userId: string,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update listings
    set owner_id = ${userId}, guest_session_id = null
    where id = ${listingId}
      and guest_session_id = ${sessionId}
      and owner_id is null
    returning id
  `;
  return rows.length;
}

async function expireSession(sessionId: string): Promise<void> {
  await getSql()`
    update guest_draft_sessions
    set expires_at = now() - interval '1 minute'
    where id = ${sessionId}
  `;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.GUEST_DRAFTS_ENABLED = "true";

  const sql = getSql();
  const [cat] = await sql<{ id: string }[]>`select id from categories where code = 'CAR'`;
  const [moto] = await sql<{ id: string }[]>`select id from categories where code = 'MOTORCYCLE'`;
  const [brand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('GuestBrand', 'guest-brand') returning id`;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand!.id}, ${cat!.id})`;
  const [model] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    values (${brand!.id}, ${cat!.id}, 'GuestModel', 'guest-model') returning id`;
  fixtures = { cat: cat!.id, moto: moto!.id, brand: brand!.id, model: model!.id };

  const owner = await createTestUserSession("+994519777888");
  const [userRow] = await sql<
    { id: string; phone_e164: string; display_name: string | null; status: "ACTIVE" | "BLOCKED" }[]
  >`select id, phone_e164, display_name, status from users where id = ${owner.userId}`;
  seller = { sessionId: randomUUID(), user: userRow!, roles: ["USER"] };
});

afterEach(() => {
  // Caps/flag tests mutate env — restore the suite default after each.
  process.env.GUEST_DRAFTS_ENABLED = "true";
  delete process.env.GUEST_SESSIONS_IP_MAX_PER_HOUR;
  delete process.env.GUEST_DRAFTS_IP_MAX_PER_HOUR;
  setStorageProviderForTesting(null);
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await closeSql();
});

describe("fail-closed flag", () => {
  it("every guest operation answers LISTING_NOT_FOUND while disabled", async () => {
    process.env.GUEST_DRAFTS_ENABLED = "false";
    await expectApiError(
      () => createGuestDraft({ presentedToken: null, ipHash: null, categoryCode: "CAR" }),
      "LISTING_NOT_FOUND",
    );
    await expectApiError(() => resolveGuestSession("whatever"), "LISTING_NOT_FOUND");
    await expectApiError(() => getGuestDraftDto(null, randomUUID()), "LISTING_NOT_FOUND");
    delete process.env.GUEST_DRAFTS_ENABLED; // unset = OFF too
    await expectApiError(
      () => createGuestDraft({ presentedToken: null, ipHash: null, categoryCode: "CAR" }),
      "LISTING_NOT_FOUND",
    );
  });
});

describe("database ownership invariants", () => {
  it("a listing must have exactly one owner (user XOR guest session)", async () => {
    const sql = getSql();
    await expect(
      sql`insert into listings (category_id, status) values (${fixtures.cat}, 'DRAFT')`,
    ).rejects.toThrow(/listings_exactly_one_owner/);
    const { listing, issuedToken } = await createGuestDraft({
      presentedToken: null,
      ipHash: null,
      categoryCode: "CAR",
    });
    expect(issuedToken).not.toBeNull();
    await expect(
      sql`update listings set owner_id = ${seller.user.id} where id = ${listing.id}`,
    ).rejects.toThrow(/listings_exactly_one_owner/);
  });

  it("a guest-owned listing can never leave DRAFT", async () => {
    const sql = getSql();
    const { listing } = await createGuestDraft({
      presentedToken: null,
      ipHash: null,
      categoryCode: "CAR",
    });
    await expect(
      sql`update listings set status = 'PENDING_MODERATION' where id = ${listing.id}`,
    ).rejects.toThrow(/listings_guest_only_draft/);
  });
});

describe("capability issuance, caps and expiry", () => {
  it("reuses the presented capability, enforces the two-draft cap", async () => {
    const first = await createGuestDraft({
      presentedToken: null,
      ipHash: null,
      categoryCode: "CAR",
    });
    const token = first.issuedToken!;
    const second = await createGuestDraft({
      presentedToken: token,
      ipHash: null,
      categoryCode: "MOTORCYCLE",
    });
    expect(second.issuedToken).toBeNull(); // no re-mint for a live capability
    await expectApiError(
      () => createGuestDraft({ presentedToken: token, ipHash: null, categoryCode: "CAR" }),
      "GUEST_DRAFT_LIMIT",
    );
  });

  it("bounds per-IP session issuance and draft creation", async () => {
    process.env.GUEST_SESSIONS_IP_MAX_PER_HOUR = "1";
    process.env.GUEST_DRAFTS_IP_MAX_PER_HOUR = "100";
    const ipHash = `iphash-${randomUUID()}`;
    const first = await createGuestDraft({
      presentedToken: null,
      ipHash,
      categoryCode: "CAR",
    });
    expect(first.issuedToken).not.toBeNull();
    // A NEW session from the same IP is refused…
    await expectApiError(
      () => createGuestDraft({ presentedToken: null, ipHash, categoryCode: "CAR" }),
      "GUEST_RATE_LIMITED",
    );
    // …while the existing capability may keep working.
    const again = await createGuestDraft({
      presentedToken: first.issuedToken,
      ipHash,
      categoryCode: "CAR",
    });
    expect(again.issuedToken).toBeNull();

    process.env.GUEST_SESSIONS_IP_MAX_PER_HOUR = "100";
    process.env.GUEST_DRAFTS_IP_MAX_PER_HOUR = "2";
    await expectApiError(
      () => createGuestDraft({ presentedToken: null, ipHash, categoryCode: "CAR" }),
      "GUEST_RATE_LIMITED",
    );
  });

  it("parallel same-IP creation cannot exceed the hourly caps (advisory-lock serialized)", async () => {
    process.env.GUEST_SESSIONS_IP_MAX_PER_HOUR = "2";
    process.env.GUEST_DRAFTS_IP_MAX_PER_HOUR = "100";
    const sessionsIp = `iphash-${randomUUID()}`;
    const sessionResults = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        createGuestDraft({ presentedToken: null, ipHash: sessionsIp, categoryCode: "CAR" }),
      ),
    );
    const sessionWins = sessionResults.filter((r) => r.status === "fulfilled");
    expect(sessionWins).toHaveLength(2); // exactly the cap, under true concurrency
    for (const r of sessionResults) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(ApiError);
        expect((r.reason as ApiError).code).toBe("GUEST_RATE_LIMITED");
      }
    }

    process.env.GUEST_SESSIONS_IP_MAX_PER_HOUR = "100";
    process.env.GUEST_DRAFTS_IP_MAX_PER_HOUR = "3";
    const draftsIp = `iphash-${randomUUID()}`;
    const draftResults = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        createGuestDraft({ presentedToken: null, ipHash: draftsIp, categoryCode: "CAR" }),
      ),
    );
    expect(draftResults.filter((r) => r.status === "fulfilled")).toHaveLength(3);
  });

  it("expiry works at query time — no cleanup required", async () => {
    const { listing, issuedToken } = await createGuestDraft({
      presentedToken: null,
      ipHash: null,
      categoryCode: "CAR",
    });
    const session = await resolveGuestSession(issuedToken!);
    expect(session).not.toBeNull();
    await expireSession(session!.sessionId);
    expect(await resolveGuestSession(issuedToken!)).toBeNull();
    await expectApiError(() => getGuestDraftDto(null, listing.id), "LISTING_NOT_FOUND");
    await expectApiError(
      () =>
        updateGuestDraft(session, listing.id, {
          expected_revision: listing.revision,
          description: "late",
        }),
      "LISTING_NOT_FOUND",
    );
    // An expired capability also never short-circuits creation limits:
    // presenting it mints a fresh session instead of reusing the dead one.
    const fresh = await createGuestDraft({
      presentedToken: issuedToken,
      ipHash: null,
      categoryCode: "CAR",
    });
    expect(fresh.issuedToken).not.toBeNull();
  });
});

describe("scoping and IDOR", () => {
  it("a foreign capability gets the same non-enumerating LISTING_NOT_FOUND", async () => {
    const a = await createGuestDraft({ presentedToken: null, ipHash: null, categoryCode: "CAR" });
    const b = await createGuestDraft({ presentedToken: null, ipHash: null, categoryCode: "CAR" });
    const sessionB = await resolveGuestSession(b.issuedToken!);
    await expectApiError(() => getGuestDraftDto(sessionB, a.listing.id), "LISTING_NOT_FOUND");
    await expectApiError(
      () =>
        updateGuestDraft(sessionB, a.listing.id, {
          expected_revision: a.listing.revision,
          description: "stolen",
        }),
      "LISTING_NOT_FOUND",
    );
    // Unknown id and a made-up token answer identically.
    await expectApiError(() => getGuestDraftDto(sessionB, randomUUID()), "LISTING_NOT_FOUND");
    expect(await resolveGuestSession(generateSessionToken())).toBeNull();
  });

  it("guest drafts and seller drafts are mutually invisible", async () => {
    const guest = await createGuestDraft({ presentedToken: null, ipHash: null, categoryCode: "CAR" });
    // The authenticated owner path cannot see or edit a guest draft…
    await expectApiError(() => getOwnedListingDto(seller, guest.listing.id), "LISTING_NOT_FOUND");
    // …and a guest capability cannot see a seller's draft.
    const sellersDraft = await createDraft(seller, "CAR");
    const session = await resolveGuestSession(guest.issuedToken!);
    await expectApiError(() => getGuestDraftDto(session, sellersDraft.id), "LISTING_NOT_FOUND");
  });
});

describe("guest PATCH semantics (shared with the seller path)", () => {
  it("applies catalog-validated patches, clears dependents, and reports revision conflicts", async () => {
    const { listing, issuedToken } = await createGuestDraft({
      presentedToken: null,
      ipHash: null,
      categoryCode: "CAR",
    });
    const session = await resolveGuestSession(issuedToken!);

    const withBrand = await updateGuestDraft(session, listing.id, {
      expected_revision: listing.revision,
      brand_id: fixtures.brand,
      model_id: fixtures.model,
      year: 2020,
    });
    expect(withBrand.brandId).toBe(fixtures.brand);
    expect(withBrand.modelId).toBe(fixtures.model);
    expect(withBrand.revision).toBe(listing.revision + 1);

    // Stale revision → conflict carrying the current revision.
    const conflict = await expectApiError(
      () =>
        updateGuestDraft(session, listing.id, {
          expected_revision: listing.revision,
          description: "stale",
        }),
      "LISTING_REVISION_CONFLICT",
    );
    expect(conflict.details).toMatchObject({ current_revision: withBrand.revision });

    // Invalid catalog selection → same error code as the seller path.
    await expectApiError(
      () =>
        updateGuestDraft(session, listing.id, {
          expected_revision: withBrand.revision,
          brand_id: randomUUID(),
        }),
      "LISTING_INVALID_CATALOG_SELECTION",
    );

    // Category change clears dependent brand/model (shared resolution).
    const switched = await updateGuestDraft(session, listing.id, {
      expected_revision: withBrand.revision,
      category: "MOTORCYCLE",
    });
    expect(switched.category).toBe("MOTORCYCLE");
    expect(switched.brandId).toBeNull();
    expect(switched.modelId).toBeNull();
  });
});

describe("authenticated seller path is unchanged", () => {
  it("create → PATCH → read works exactly as before", async () => {
    const draft = await createDraft(seller, "CAR");
    const updated = await updateDraft(seller, draft.id, {
      expected_revision: draft.revision,
      brand_id: fixtures.brand,
      model_id: fixtures.model,
    });
    expect(updated.brandId).toBe(fixtures.brand);
    const read = await getOwnedListingDto(seller, draft.id);
    expect(read.revision).toBe(draft.revision + 1);
  });
});

describe("expired-guest-draft cleanup", () => {
  function recordingStorage(failPath: string | null): {
    provider: StorageProvider;
    deleted: { bucket: string; path: string }[];
  } {
    const deleted: { bucket: string; path: string }[] = [];
    const provider: StorageProvider = {
      async createSignedUploadUrl() {
        throw new Error("unused");
      },
      async downloadObject() {
        return null;
      },
      async uploadObject() {
        throw new Error("unused");
      },
      async deleteObject(bucket, path) {
        if (failPath !== null && path === failPath) {
          throw new Error("storage outage");
        }
        deleted.push({ bucket, path });
      },
      async createSignedReadUrl() {
        throw new Error("unused");
      },
    };
    return { provider, deleted };
  }

  async function expiredGuestListingWithObjects(): Promise<{
    listingId: string;
    sessionId: string;
    finalPath: string;
    tempPath: string;
  }> {
    const sql = getSql();
    const { listing, issuedToken } = await createGuestDraft({
      presentedToken: null,
      ipHash: null,
      categoryCode: "CAR",
    });
    const session = await resolveGuestSession(issuedToken!);
    const finalPath = `listings/${randomUUID()}.webp`;
    const tempPath = `uploads/guest-test/${randomUUID()}`;
    await sql`
      insert into listing_images (listing_id, storage_path, mime_type, file_size_bytes, is_primary)
      values (${listing.id}, ${finalPath}, 'image/webp', 1234, true)
    `;
    await sql`
      insert into listing_image_uploads
        (listing_id, user_id, temp_storage_path, declared_mime_type, declared_size_bytes, expires_at)
      values (${listing.id}, ${seller.user.id}, ${tempPath}, 'image/webp', 1234, now() + interval '1 hour')
    `;
    await expireSession(session!.sessionId);
    return { listingId: listing.id, sessionId: session!.sessionId, finalPath, tempPath };
  }

  it("a claim that wins the row lock first makes cleanup skip — storage untouched (interleaving A)", async () => {
    const sql = getSql();
    const fixture = await expiredGuestListingWithObjects();
    const storage = recordingStorage(null);
    setStorageProviderForTesting(storage.provider);

    // The claim transaction takes the listings row lock FIRST and
    // holds it while cleanup starts and blocks on its condemn lock.
    const claimTx = withTransaction(async (tx) => {
      const claimed = await simulateClaim(tx, fixture.listingId, fixture.sessionId, seller.user.id);
      await delay(600);
      return claimed;
    });
    await delay(150); // the claim holds the row lock now
    const cleanup = runGuestDraftCleanup({ graceSeconds: 0 });
    const [claimed] = await Promise.all([claimTx, cleanup]);

    expect(claimed).toBe(1);
    // The summary may count OTHER tests' expired leftovers — the
    // invariant is about THIS listing: row kept, owner set, image
    // row intact, no storage delete, no durable cleanup record.
    const [row] = await sql<{ owner_id: string | null }[]>`
      select owner_id from listings where id = ${fixture.listingId}
    `;
    expect(row?.owner_id).toBe(seller.user.id);
    const [image] = await sql<{ id: string }[]>`
      select id from listing_images where listing_id = ${fixture.listingId}
    `;
    expect(image).toBeDefined();
    // No object of this listing was deleted and no durable cleanup
    // record exists for it — a successful claim never loses storage.
    expect(storage.deleted.map((d) => d.path)).not.toContain(fixture.finalPath);
    expect(storage.deleted.map((d) => d.path)).not.toContain(fixture.tempPath);
    const [event] = await sql<{ id: string }[]>`
      select id from outbox_events
      where event_type = ${GUEST_DRAFT_DELETED_EVENT} and aggregate_id = ${fixture.listingId}
    `;
    expect(event).toBeUndefined();
  });

  it("a condemn that wins first makes the claim fail cleanly; storage dies only afterwards (interleaving B)", async () => {
    const sql = getSql();
    const fixture = await expiredGuestListingWithObjects();
    const storage = recordingStorage(null);
    setStorageProviderForTesting(storage.provider);

    // Cleanup's condemn step (exact service semantics: locked
    // re-check + row delete + durable record in ONE transaction)
    // takes the row lock first and holds it while the claim arrives.
    const condemnTx = withTransaction(async (tx) => {
      const result = await condemnExpiredGuestListing(tx, fixture.listingId, 0);
      expect(result.condemned).toBe(true);
      if (result.condemned) {
        await insertOutboxEvent(tx, {
          eventType: GUEST_DRAFT_DELETED_EVENT,
          aggregateId: fixture.listingId,
          payload: {
            listing_id: fixture.listingId,
            cleanup_image_paths: result.imagePaths.join(","),
            cleanup_upload_paths: result.uploadPaths.join(","),
          },
        });
      }
      await delay(600);
      return result;
    });
    await delay(150); // condemn holds the row lock now
    const claimPromise = simulateClaim(sql, fixture.listingId, fixture.sessionId, seller.user.id);
    const [condemned, claimed] = await Promise.all([condemnTx, claimPromise]);

    expect(condemned.condemned).toBe(true);
    expect(claimed).toBe(0); // the claim failed cleanly — zero rows
    // Storage is deleted only now, from the durable record.
    const summary = await runGuestDraftCleanup({ graceSeconds: 0 });
    expect(summary.objectsDeleted).toBeGreaterThanOrEqual(2);
    expect(storage.deleted).toContainEqual({ bucket: "listing-images", path: fixture.finalPath });
    expect(storage.deleted).toContainEqual({ bucket: "listing-uploads", path: fixture.tempPath });
  });

  it("deletes finals from imagesBucket and temps from uploadsBucket, with retry on failure", async () => {
    const sql = getSql();
    const fixture = await expiredGuestListingWithObjects();

    // Run 1: the TEMP delete keeps failing → event returns to PENDING
    // with backoff; the row deletion itself already committed.
    const failing = recordingStorage(fixture.tempPath);
    setStorageProviderForTesting(failing.provider);
    const first = await runGuestDraftCleanup({ graceSeconds: 0 });
    expect(first.listingsDeleted).toBeGreaterThanOrEqual(1);
    expect(first.retried).toBeGreaterThanOrEqual(1);
    expect(failing.deleted).toContainEqual({ bucket: "listing-images", path: fixture.finalPath });
    const [pending] = await sql<{ status: string; attempt_count: number; available_at: Date }[]>`
      select status, attempt_count, available_at from outbox_events
      where event_type = ${GUEST_DRAFT_DELETED_EVENT} and aggregate_id = ${fixture.listingId}
    `;
    expect(pending).toMatchObject({ status: "PENDING", attempt_count: 1 });
    expect(pending!.available_at.getTime()).toBeGreaterThan(Date.now());

    // Run 2 (backoff elapsed, storage recovered): both bucket/path
    // pairs are deleted and the event completes.
    await sql`
      update outbox_events set available_at = now()
      where event_type = ${GUEST_DRAFT_DELETED_EVENT} and aggregate_id = ${fixture.listingId}
    `;
    const recovered = recordingStorage(null);
    setStorageProviderForTesting(recovered.provider);
    const second = await runGuestDraftCleanup({ graceSeconds: 0 });
    expect(second.objectsDeleted).toBeGreaterThanOrEqual(2);
    expect(recovered.deleted).toContainEqual({ bucket: "listing-images", path: fixture.finalPath });
    expect(recovered.deleted).toContainEqual({ bucket: "listing-uploads", path: fixture.tempPath });
    const [processed] = await sql<{ status: string }[]>`
      select status from outbox_events
      where event_type = ${GUEST_DRAFT_DELETED_EVENT} and aggregate_id = ${fixture.listingId}
    `;
    expect(processed).toMatchObject({ status: "PROCESSED" });

    // Idempotent: nothing left to claim for this listing.
    const third = await runGuestDraftCleanup({ graceSeconds: 0 });
    expect(third.failed).toBe(0);
    const [sessionGone] = await sql<{ id: string }[]>`
      select id from guest_draft_sessions where id = ${fixture.sessionId}
    `;
    expect(sessionGone).toBeUndefined();
  });

  it("the execution-time re-check retains a path that is still referenced", async () => {
    const sql = getSql();
    const fixture = await expiredGuestListingWithObjects();
    // Another LIVE listing references the same final path (defense in
    // depth, O.12 doctrine: never trust the event payload alone).
    const live = await createDraft(seller, "CAR");
    await sql`
      insert into listing_images (listing_id, storage_path, mime_type, file_size_bytes, is_primary)
      values (${live.id}, ${fixture.finalPath}, 'image/webp', 1234, true)
    `;
    const storage = recordingStorage(null);
    setStorageProviderForTesting(storage.provider);
    const summary = await runGuestDraftCleanup({ graceSeconds: 0 });
    expect(summary.retained).toBeGreaterThanOrEqual(1);
    expect(storage.deleted.map((d) => d.path)).not.toContain(fixture.finalPath);
    expect(storage.deleted).toContainEqual({ bucket: "listing-uploads", path: fixture.tempPath });
  });
});
