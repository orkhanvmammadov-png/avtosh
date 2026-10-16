import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { generateSessionToken } from "@/auth/otp-crypto";
import { ApiError } from "@/lib/api/errors";
import { closeSql, getSql } from "@/lib/server/db/client";
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
import { deleteExpiredGuestListing } from "@/repositories/guest-drafts";
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
    deleted: string[];
  } {
    const deleted: string[] = [];
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
      async deleteObject(_bucket, path) {
        if (failPath !== null && path === failPath) {
          throw new Error("storage outage");
        }
        deleted.push(path);
      },
      async createSignedReadUrl() {
        throw new Error("unused");
      },
    };
    return { provider, deleted };
  }

  it("deletes storage objects before rows, retries after failures, idempotent", async () => {
    const sql = getSql();
    const { listing, issuedToken } = await createGuestDraft({
      presentedToken: null,
      ipHash: null,
      categoryCode: "CAR",
    });
    const session = await resolveGuestSession(issuedToken!);
    const objectPath = `listings/${randomUUID()}.webp`;
    await sql`
      insert into listing_images (listing_id, storage_path, mime_type, file_size_bytes, is_primary)
      values (${listing.id}, ${objectPath}, 'image/webp', 1234, true)
    `;
    await expireSession(session!.sessionId);

    // First run: storage deletion keeps failing → the ROW must survive
    // the whole run (objects can never be orphaned by a row-first delete).
    const failing = recordingStorage(objectPath);
    setStorageProviderForTesting(failing.provider);
    const first = await runGuestDraftCleanup({ graceSeconds: 0 });
    expect(first.failed).toBeGreaterThanOrEqual(1);
    const [survivor] = await sql<{ id: string }[]>`
      select id from listings where id = ${listing.id}
    `;
    expect(survivor).toBeDefined();

    // Second run (storage recovered): object deleted, then row, then session.
    const recovered = recordingStorage(null);
    setStorageProviderForTesting(recovered.provider);
    const second = await runGuestDraftCleanup({ graceSeconds: 0 });
    expect(recovered.deleted).toContain(objectPath);
    expect(second.listingsDeleted).toBeGreaterThanOrEqual(1);
    const [gone] = await sql<{ id: string }[]>`
      select id from listings where id = ${listing.id}
    `;
    expect(gone).toBeUndefined();
    const [sessionGone] = await sql<{ id: string }[]>`
      select id from guest_draft_sessions where id = ${session!.sessionId}
    `;
    expect(sessionGone).toBeUndefined();

    // Idempotent: a further run finds nothing to do for this listing.
    const third = await runGuestDraftCleanup({ graceSeconds: 0 });
    expect(third.failed).toBe(0);
  });

  it("never deletes a listing that was claimed between selection and deletion", async () => {
    const sql = getSql();
    const { listing, issuedToken } = await createGuestDraft({
      presentedToken: null,
      ipHash: null,
      categoryCode: "CAR",
    });
    const session = await resolveGuestSession(issuedToken!);
    await expireSession(session!.sessionId);
    // Simulate a PR-C claim racing the cleanup: the row now has a real
    // owner — the guarded DELETE must be a no-op.
    await sql`
      update listings set owner_id = ${seller.user.id}, guest_session_id = null
      where id = ${listing.id}
    `;
    const deleted = await deleteExpiredGuestListing(sql, listing.id, 0);
    expect(deleted).toBe(false);
    const [stillThere] = await sql<{ id: string }[]>`
      select id from listings where id = ${listing.id}
    `;
    expect(stillThere).toBeDefined();
  });
});
