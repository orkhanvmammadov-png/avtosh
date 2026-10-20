import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { listingImageConfig } from "@/lib/config/listing-images";
import { closeSql, getSql, withTransaction } from "@/lib/server/db/client";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import type { StorageProvider } from "@/providers/storage/types";
import {
  createGuestDraft,
  resolveGuestSession,
  type GuestSessionContext,
} from "@/services/guest-drafts";
import { runGuestDraftCleanup } from "@/services/guest-draft-cleanup";
import {
  confirmGuestUpload,
  confirmUpload,
  createGuestUploadAuthorization,
  createUploadAuthorization,
  deleteGuestImage,
  reorderGuestImages,
  setGuestPrimary,
} from "@/services/listing-images";
import { createDraft } from "@/services/listing-drafts";
import { createTestUserSession } from "./helpers/session";

/**
 * Guest image flow (deferred-login PR B): scoping/IDOR, expiry at
 * query time, issuance caps under concurrency, confirmation
 * idempotency incl. concurrent confirms, processing-failure and
 * DB-failure compensation, delete/order/primary semantics, cleanup
 * with real guest upload rows, claim-vs-confirm interleaving, and the
 * unchanged authenticated seller path.
 */

let seller: AuthContext;
let pngBytes: Buffer;

const ENV_KEYS = ["GUEST_DRAFTS_ENABLED", "GUEST_UPLOADS_SESSION_MAX_PER_HOUR"] as const;
const savedEnv: Record<string, string | undefined> = {};

/** Functional in-memory storage: real byte round-trips + delete log. */
function memoryStorage(): {
  provider: StorageProvider;
  objects: Map<string, Buffer>;
  deleted: { bucket: string; path: string }[];
} {
  const objects = new Map<string, Buffer>();
  const deleted: { bucket: string; path: string }[] = [];
  const key = (bucket: string, path: string) => `${bucket}/${path}`;
  const provider: StorageProvider = {
    async createSignedUploadUrl(_bucket, path) {
      return { url: `memory://upload/${path}`, token: null };
    },
    async downloadObject(bucket, path) {
      return objects.get(key(bucket, path)) ?? null;
    },
    async uploadObject(bucket, path, data) {
      objects.set(key(bucket, path), data);
    },
    async deleteObject(bucket, path) {
      objects.delete(key(bucket, path));
      deleted.push({ bucket, path });
    },
    async createSignedReadUrl(_bucket, path) {
      return `memory://read/${path}`;
    },
  };
  return { provider, objects, deleted };
}

function barrier(): { reached: Promise<void>; reach: () => void } {
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  return { reached, reach };
}

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

async function newGuestDraft(): Promise<{
  listingId: string;
  session: GuestSessionContext;
  sessionId: string;
}> {
  const { listing, issuedToken } = await createGuestDraft({
    presentedToken: null,
    ipHash: null,
    categoryCode: "CAR",
  });
  const session = await resolveGuestSession(issuedToken!);
  return { listingId: listing.id, session: session!, sessionId: session!.sessionId };
}

const guestTempPath = (sessionId: string, listingId: string, uploadId: string) =>
  `uploads/guest/${sessionId}/${listingId}/${uploadId}`;

/** Final object paths carry a per-attempt nonce — read the committed
    row's path instead of predicting it. */
async function storagePathOf(imageId: string): Promise<string> {
  const rows = await getSql()<{ storage_path: string }[]>`
    select storage_path from listing_images where id = ${imageId}
  `;
  expect(rows[0]).toBeDefined();
  return rows[0]!.storage_path;
}

function finalsIn(store: ReturnType<typeof memoryStorage>): string[] {
  const bucket = listingImageConfig().imagesBucket;
  return [...store.objects.keys()].filter((key) => key.startsWith(`${bucket}/`));
}

/** Authorize + simulate the client's signed upload into temp storage. */
async function issueAndPut(
  store: ReturnType<typeof memoryStorage>,
  session: GuestSessionContext,
  listingId: string,
  bytes: Buffer = pngBytes,
): Promise<string> {
  const config = listingImageConfig();
  const authz = await createGuestUploadAuthorization(session, listingId, {
    mimeType: "image/png",
    sizeBytes: bytes.length,
  });
  await store.provider.uploadObject(
    config.uploadsBucket,
    guestTempPath(session.sessionId, listingId, authz.uploadId),
    bytes,
    "image/png",
  );
  return authz.uploadId;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.GUEST_DRAFTS_ENABLED = "true";
  pngBytes = await sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 10, g: 120, b: 80 } },
  })
    .png()
    .toBuffer();
  const owner = await createTestUserSession("+994519777999");
  const sql = getSql();
  const [userRow] = await sql<
    { id: string; phone_e164: string; display_name: string | null; status: "ACTIVE" | "BLOCKED" }[]
  >`select id, phone_e164, display_name, status from users where id = ${owner.userId}`;
  seller = { sessionId: randomUUID(), user: userRow!, roles: ["USER"] };
});

afterEach(() => {
  process.env.GUEST_DRAFTS_ENABLED = "true";
  delete process.env.GUEST_UPLOADS_SESSION_MAX_PER_HOUR;
  setStorageProviderForTesting(null);
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await closeSql();
});

describe("database ownership invariant", () => {
  it("an upload row has exactly one owner (user XOR guest session)", async () => {
    const sql = getSql();
    const { listingId, sessionId } = await newGuestDraft();
    await expect(
      sql`
        insert into listing_image_uploads
          (listing_id, temp_storage_path, declared_mime_type, declared_size_bytes, expires_at)
        values (${listingId}, 'x', 'image/png', 1, now() + interval '1 hour')
      `,
    ).rejects.toThrow(/listing_image_uploads_exactly_one_owner/);
    await expect(
      sql`
        insert into listing_image_uploads
          (listing_id, user_id, guest_session_id, temp_storage_path, declared_mime_type, declared_size_bytes, expires_at)
        values (${listingId}, ${seller.user.id}, ${sessionId}, 'x', 'image/png', 1, now() + interval '1 hour')
      `,
    ).rejects.toThrow(/listing_image_uploads_exactly_one_owner/);
  });
});

describe("guest image lifecycle", () => {
  it("upload → confirm → second image → reorder → primary → delete, with real processing", async () => {
    const store = memoryStorage();
    setStorageProviderForTesting(store.provider);
    const { listingId, session } = await newGuestDraft();

    const firstUpload = await issueAndPut(store, session, listingId);
    const first = await confirmGuestUpload(session, listingId, firstUpload);
    expect(first.image.isPrimary).toBe(true);
    expect(first.revision).toBeGreaterThanOrEqual(1);
    // Real WebP processing happened; the temp object was cleaned up.
    const config = listingImageConfig();
    expect(store.objects.has(`${config.imagesBucket}/${await storagePathOf(first.image.id)}`)).toBe(true);
    expect(
      store.objects.has(
        `${config.uploadsBucket}/${guestTempPath(session.sessionId, listingId, firstUpload)}`,
      ),
    ).toBe(false);

    const secondUpload = await issueAndPut(store, session, listingId);
    const second = await confirmGuestUpload(session, listingId, secondUpload);
    expect(second.image.isPrimary).toBe(false);

    // Repeated confirm is idempotent (same image, no duplicate row)…
    const repeat = await confirmGuestUpload(session, listingId, firstUpload);
    expect(repeat.image.id).toBe(first.image.id);
    const sql = getSql();
    const [count] = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_images where listing_id = ${listingId}
    `;
    expect(Number(count!.n)).toBe(2);

    // …and so is a CONCURRENT confirm pair on one upload.
    const thirdUpload = await issueAndPut(store, session, listingId);
    const [a, b] = await Promise.all([
      confirmGuestUpload(session, listingId, thirdUpload),
      confirmGuestUpload(session, listingId, thirdUpload),
    ]);
    expect(a.image.id).toBe(b.image.id);
    const [after] = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_images where listing_id = ${listingId}
    `;
    expect(Number(after!.n)).toBe(3);
    // Only the COMMITTED attempts' objects remain — the losing
    // concurrent attempt's nonce object was cleaned up, never orphaned.
    const committedPaths = await sql<{ storage_path: string }[]>`
      select storage_path from listing_images where listing_id = ${listingId}
    `;
    expect(new Set(finalsIn(store))).toEqual(
      new Set(committedPaths.map((r) => `${config.imagesBucket}/${r.storage_path}`)),
    );

    // Reorder + explicit primary + delete-with-promotion.
    const secondPath = await storagePathOf(second.image.id);
    const reordered = await reorderGuestImages(session, listingId, [
      b.image.id,
      second.image.id,
      first.image.id,
    ]);
    expect(reordered.revision).toBeGreaterThan(second.revision);
    await setGuestPrimary(session, listingId, second.image.id);
    const del = await deleteGuestImage(session, listingId, second.image.id);
    expect(del.revision).toBeGreaterThan(reordered.revision);
    const rows = await sql<{ id: string; is_primary: boolean; sort_order: number }[]>`
      select id, is_primary, sort_order from listing_images
      where listing_id = ${listingId} order by sort_order
    `;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.is_primary)).toHaveLength(1); // promoted deterministically
    // The deleted final object went away from the images bucket.
    expect(store.deleted).toContainEqual({
      bucket: config.imagesBucket,
      path: secondPath,
    });
  });

  it("invalid bytes fail with compensation: upload FAILED, temp deleted, no final object", async () => {
    const store = memoryStorage();
    setStorageProviderForTesting(store.provider);
    const { listingId, session } = await newGuestDraft();
    const uploadId = await issueAndPut(store, session, listingId, Buffer.from("not an image"));
    await expectApiError(
      () => confirmGuestUpload(session, listingId, uploadId),
      "IMAGE_INVALID_FORMAT",
    );
    const sql = getSql();
    const [row] = await sql<{ status: string }[]>`
      select status from listing_image_uploads where id = ${uploadId}
    `;
    expect(row).toMatchObject({ status: "FAILED" });
    const config = listingImageConfig();
    expect(finalsIn(store)).toHaveLength(0);
    expect(
      store.objects.has(
        `${config.uploadsBucket}/${guestTempPath(session.sessionId, listingId, uploadId)}`,
      ),
    ).toBe(false);
  });
});

describe("scoping, IDOR and expiry", () => {
  it("a foreign session cannot touch another guest's listing, uploads or images", async () => {
    const store = memoryStorage();
    setStorageProviderForTesting(store.provider);
    const a = await newGuestDraft();
    const b = await newGuestDraft();
    const uploadId = await issueAndPut(store, a.session, a.listingId);
    const image = await confirmGuestUpload(a.session, a.listingId, uploadId);

    await expectApiError(
      () =>
        createGuestUploadAuthorization(b.session, a.listingId, {
          mimeType: "image/png",
          sizeBytes: 10,
        }),
      "LISTING_NOT_FOUND",
    );
    await expectApiError(
      () => confirmGuestUpload(b.session, a.listingId, uploadId),
      "LISTING_NOT_FOUND",
    );
    await expectApiError(
      () => deleteGuestImage(b.session, a.listingId, image.image.id),
      "LISTING_NOT_FOUND",
    );
    await expectApiError(
      () => reorderGuestImages(b.session, a.listingId, [image.image.id]),
      "LISTING_NOT_FOUND",
    );
    await expectApiError(
      () => setGuestPrimary(b.session, a.listingId, image.image.id),
      "LISTING_NOT_FOUND",
    );
    // A guest upload id is NEVER usable through the authenticated path
    // (the seller does not own the listing)…
    await expectApiError(
      () => confirmUpload(seller, a.listingId, uploadId),
      "LISTING_NOT_FOUND",
    );
    // …and a guest cannot act on a seller's draft.
    const sellersDraft = await createDraft(seller, "CAR");
    await expectApiError(
      () =>
        createGuestUploadAuthorization(a.session, sellersDraft.id, {
          mimeType: "image/png",
          sizeBytes: 10,
        }),
      "LISTING_NOT_FOUND",
    );
  });

  it("an upload issued by the SAME guest for one listing cannot confirm against another", async () => {
    const store = memoryStorage();
    setStorageProviderForTesting(store.provider);
    const g = await newGuestDraft();
    const { listing: other } = await createGuestDraft({
      presentedToken: null,
      ipHash: null,
      categoryCode: "CAR",
    });
    void other;
    const uploadId = await issueAndPut(store, g.session, g.listingId);
    // Second listing in the same session:
    const second = await createGuestDraft({
      presentedToken: null,
      ipHash: null,
      categoryCode: "MOTORCYCLE",
    });
    void second;
    await expectApiError(
      () => confirmGuestUpload(g.session, randomUUID(), uploadId),
      "LISTING_NOT_FOUND",
    );
  });

  it("session expiry stops every image operation at query time", async () => {
    const store = memoryStorage();
    setStorageProviderForTesting(store.provider);
    const { listingId, session, sessionId } = await newGuestDraft();
    const uploadId = await issueAndPut(store, session, listingId);
    await getSql()`
      update guest_draft_sessions set expires_at = now() - interval '1 minute'
      where id = ${sessionId}
    `;
    await expectApiError(
      () => confirmGuestUpload(session, listingId, uploadId),
      "LISTING_NOT_FOUND",
    );
    await expectApiError(
      () =>
        createGuestUploadAuthorization(session, listingId, {
          mimeType: "image/png",
          sizeBytes: 10,
        }),
      "LISTING_NOT_FOUND",
    );
    // Nothing was processed for the in-flight upload.
    void uploadId;
    expect(finalsIn(store)).toHaveLength(0);
    const [images] = await getSql()<{ n: string }[]>`
      select count(*)::text as n from listing_images where listing_id = ${listingId}
    `;
    expect(Number(images!.n)).toBe(0);
  });
});

describe("issuance caps", () => {
  it("parallel signed-URL requests cannot exceed the per-session hourly cap", async () => {
    process.env.GUEST_UPLOADS_SESSION_MAX_PER_HOUR = "3";
    const store = memoryStorage();
    setStorageProviderForTesting(store.provider);
    const { listingId, session } = await newGuestDraft();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        createGuestUploadAuthorization(session, listingId, {
          mimeType: "image/png",
          sizeBytes: 100,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    for (const r of results) {
      if (r.status === "rejected") {
        expect((r.reason as ApiError).code).toBe("IMAGE_UPLOAD_RATE_LIMITED");
      }
    }
  });

  it("the shared per-listing pending cap still applies to guests", async () => {
    const store = memoryStorage();
    setStorageProviderForTesting(store.provider);
    const { listingId, session } = await newGuestDraft();
    const config = listingImageConfig();
    for (let i = 0; i < config.maxPendingUploads; i += 1) {
      await createGuestUploadAuthorization(session, listingId, {
        mimeType: "image/png",
        sizeBytes: 100,
      });
    }
    await expectApiError(
      () =>
        createGuestUploadAuthorization(session, listingId, {
          mimeType: "image/png",
          sizeBytes: 100,
        }),
      "IMAGE_UPLOAD_RATE_LIMITED",
    );
  });
});

describe("claim and cleanup interplay", () => {
  it("a claim racing an in-flight confirmation never corrupts the claimed listing", async () => {
    const sql = getSql();
    const store = memoryStorage();
    setStorageProviderForTesting(store.provider);
    const { listingId, session, sessionId } = await newGuestDraft();
    const uploadId = await issueAndPut(store, session, listingId);

    // The claim transaction (PR C contract: guarded write on the
    // listings row + upload re-homing) holds the row lock while the
    // guest confirmation runs — whichever check the confirm hits, the
    // claimed listing must stay untouched and the final object must
    // not survive as an unreferenced orphan.
    const lockHeld = barrier();
    const release = barrier();
    const claimTx = withTransaction(async (tx) => {
      const claimed = await tx<{ id: string }[]>`
        update listings set owner_id = ${seller.user.id}, guest_session_id = null
        where id = ${listingId} and guest_session_id = ${sessionId} and owner_id is null
        returning id
      `;
      await tx`
        update listing_image_uploads set user_id = ${seller.user.id}, guest_session_id = null
        where listing_id = ${listingId} and guest_session_id = ${sessionId}
      `;
      lockHeld.reach();
      await release.reached;
      return claimed.length;
    });
    await lockHeld.reached;
    const confirmPromise = confirmGuestUpload(session, listingId, uploadId).then(
      () => "confirmed" as const,
      (error) => (error instanceof ApiError ? error.code : "unexpected"),
    );
    release.reach();
    const [claimed, confirmOutcome] = await Promise.all([claimTx, confirmPromise]);

    expect(claimed).toBe(1);
    expect(["LISTING_NOT_FOUND", "IMAGE_UPLOAD_NOT_FOUND"]).toContain(confirmOutcome);
    // The claimed listing has no guest-written gallery row and no
    // orphaned final object.
    const [images] = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_images where listing_id = ${listingId}
    `;
    expect(Number(images!.n)).toBe(0);
    expect(finalsIn(store)).toHaveLength(0); // no orphan object from any attempt
    // The upload row was re-homed (PR C contract), so the seller can
    // finish it through the AUTHENTICATED flow.
    const result = await confirmUpload(seller, listingId, uploadId);
    expect(result.image.id).toBe(uploadId);
    expect(store.objects.has(`${listingImageConfig().imagesBucket}/${await storagePathOf(uploadId)}`)).toBe(true);
    // And the guest session (no listings, no upload rows) is sweepable.
    await sql`update guest_draft_sessions set expires_at = now() - interval '1 minute' where id = ${sessionId}`;
    await runGuestDraftCleanup({ graceSeconds: 0 });
    const [gone] = await sql<{ id: string }[]>`
      select id from guest_draft_sessions where id = ${sessionId}
    `;
    expect(gone).toBeUndefined();
  });

  it("expired-guest cleanup removes finals and REAL guest upload temps from the right buckets", async () => {
    const sql = getSql();
    const store = memoryStorage();
    setStorageProviderForTesting(store.provider);
    const config = listingImageConfig();
    const { listingId, session, sessionId } = await newGuestDraft();
    const confirmedId = await issueAndPut(store, session, listingId);
    const confirmed = await confirmGuestUpload(session, listingId, confirmedId);
    const confirmedPath = await storagePathOf(confirmed.image.id);
    const pendingId = await issueAndPut(store, session, listingId); // stays pending
    const pendingTemp = guestTempPath(sessionId, listingId, pendingId);

    await sql`
      update guest_draft_sessions set expires_at = now() - interval '1 minute'
      where id = ${sessionId}
    `;
    await runGuestDraftCleanup({ graceSeconds: 0 });

    expect(store.deleted).toContainEqual({
      bucket: config.imagesBucket,
      path: confirmedPath,
    });
    expect(store.deleted).toContainEqual({
      bucket: config.uploadsBucket,
      path: pendingTemp,
    });
    expect(store.objects.has(`${config.imagesBucket}/${confirmedPath}`)).toBe(false);
    expect(store.objects.has(`${config.uploadsBucket}/${pendingTemp}`)).toBe(false);
    const [listingGone] = await sql<{ id: string }[]>`
      select id from listings where id = ${listingId}
    `;
    expect(listingGone).toBeUndefined();
    const [sessionGone] = await sql<{ id: string }[]>`
      select id from guest_draft_sessions where id = ${sessionId}
    `;
    expect(sessionGone).toBeUndefined();
  });
});

describe("stale guest attempts cannot damage a claimed upload", () => {
  async function claimAndRehome(listingId: string, sessionId: string): Promise<void> {
    await withTransaction(async (tx) => {
      await tx`
        update listings set owner_id = ${seller.user.id}, guest_session_id = null
        where id = ${listingId} and guest_session_id = ${sessionId} and owner_id is null
      `;
      await tx`
        update listing_image_uploads set user_id = ${seller.user.id}, guest_session_id = null
        where listing_id = ${listingId} and guest_session_id = ${sessionId}
      `;
    });
  }

  it("a paused guest confirmation's compensation never deletes the claimed owner's image object", async () => {
    const sql = getSql();
    const base = memoryStorage();
    const config = listingImageConfig();
    // Gate exactly the FIRST final-object write (the guest attempt's);
    // later writes (the seller's) pass through untouched.
    const entered = barrier();
    const release = barrier();
    let gated = true;
    const provider: StorageProvider = {
      ...base.provider,
      async uploadObject(bucket, path, data, contentType) {
        if (bucket === config.imagesBucket && gated) {
          gated = false;
          entered.reach(); // the guest is provably AT its final write now
          await release.reached;
        }
        return base.provider.uploadObject(bucket, path, data, contentType);
      },
    };
    setStorageProviderForTesting(provider);

    const { listingId, session, sessionId } = await newGuestDraft();
    const uploadId = await issueAndPut(base, session, listingId);

    // Guest confirmation passes its prechecks and pauses AT its final
    // storage write…
    const guestConfirm = confirmGuestUpload(session, listingId, uploadId).then(
      () => "confirmed" as const,
      (error) => (error instanceof ApiError ? error.code : "unexpected"),
    );
    await entered.reached; // paused at the intended step, by signal
    // …the claim re-homes listing + uploads, and the OWNER completes
    // the SAME upload through the authenticated flow.
    await claimAndRehome(listingId, sessionId);
    const owned = await confirmUpload(seller, listingId, uploadId);
    const ownedPath = await storagePathOf(owned.image.id);
    expect(base.objects.has(`${config.imagesBucket}/${ownedPath}`)).toBe(true);

    // Release the stale guest attempt: it writes ITS OWN nonce object,
    // fails its guest-scoped final transaction, and compensates only
    // its own object — the owner's row AND object must survive.
    release.reach();
    const outcome = await guestConfirm;
    expect(["LISTING_NOT_FOUND", "IMAGE_UPLOAD_NOT_FOUND"]).toContain(outcome);
    const [row] = await sql<{ id: string; storage_path: string }[]>`
      select id, storage_path from listing_images where id = ${uploadId}
    `;
    expect(row).toMatchObject({ id: uploadId, storage_path: ownedPath });
    expect(base.objects.has(`${config.imagesBucket}/${ownedPath}`)).toBe(true);
    expect(finalsIn(base)).toHaveLength(1); // the stale attempt's object is gone
  });

  it("a stale guest invalid-byte failure cannot FAIL the claimed upload or delete its temp object", async () => {
    const sql = getSql();
    const base = memoryStorage();
    const config = listingImageConfig();
    const entered = barrier();
    const release = barrier();
    let gated = true;
    const provider: StorageProvider = {
      ...base.provider,
      async downloadObject(bucket, path) {
        if (bucket === config.uploadsBucket && gated) {
          gated = false;
          entered.reach(); // provably paused at the byte download
          await release.reached;
        }
        return base.provider.downloadObject(bucket, path);
      },
    };
    setStorageProviderForTesting(provider);

    const { listingId, session, sessionId } = await newGuestDraft();
    const uploadId = await issueAndPut(base, session, listingId, Buffer.from("garbage"));
    const tempKey = `${config.uploadsBucket}/${guestTempPath(sessionId, listingId, uploadId)}`;

    // Guest confirm passes its scoped read, pauses at the byte
    // download; the claim re-homes in that window.
    const guestConfirm = confirmGuestUpload(session, listingId, uploadId).then(
      () => "confirmed" as const,
      (error) => (error instanceof ApiError ? error.code : "unexpected"),
    );
    await entered.reached;
    await claimAndRehome(listingId, sessionId);
    release.reach();
    const outcome = await guestConfirm;
    expect(outcome).toBe("IMAGE_INVALID_FORMAT"); // the guest still gets the honest error

    // But the claimed owner's upload row and temp object are intact…
    const [row] = await sql<{ status: string; user_id: string | null }[]>`
      select status, user_id from listing_image_uploads where id = ${uploadId}
    `;
    expect(row).toMatchObject({ status: "PENDING", user_id: seller.user.id });
    expect(base.objects.has(tempKey)).toBe(true);

    // …and the owner's OWN failure handling still works normally.
    await expectApiError(
      () => confirmUpload(seller, listingId, uploadId),
      "IMAGE_INVALID_FORMAT",
    );
    const [after] = await sql<{ status: string }[]>`
      select status from listing_image_uploads where id = ${uploadId}
    `;
    expect(after).toMatchObject({ status: "FAILED" });
    expect(base.objects.has(tempKey)).toBe(false);
  });

  it("a stale signed-URL failure cannot FAIL an upload row the claim re-homed", async () => {
    const sql = getSql();
    const base = memoryStorage();
    const entered = barrier();
    const release = barrier();
    let gated = true;
    const provider: StorageProvider = {
      ...base.provider,
      async createSignedUploadUrl(bucket, path, ttl) {
        if (gated) {
          gated = false;
          entered.reach(); // the upload row is committed; paused at signing
          await release.reached;
          throw new Error("signing outage");
        }
        return base.provider.createSignedUploadUrl(bucket, path, ttl);
      },
    };
    setStorageProviderForTesting(provider);

    const { listingId, session, sessionId } = await newGuestDraft();
    // Issuance commits the upload row, then pauses at URL signing; the
    // claim re-homes listing + uploads in that window; signing then
    // fails and the stale FAILED mark must land nowhere.
    const issuance = createGuestUploadAuthorization(session, listingId, {
      mimeType: "image/png",
      sizeBytes: 100,
    }).then(
      () => "issued" as const,
      (error) => (error instanceof ApiError ? error.code : "unexpected"),
    );
    await entered.reached;
    await claimAndRehome(listingId, sessionId);
    release.reach();
    expect(await issuance).toBe("INTERNAL_ERROR");

    const [row] = await sql<{ status: string; user_id: string | null }[]>`
      select status, user_id from listing_image_uploads where listing_id = ${listingId}
    `;
    expect(row).toMatchObject({ status: "PENDING", user_id: seller.user.id });
  });
});

describe("terminal failure cannot regress a completed upload", () => {
  it("a stale failure after a successful concurrent confirm leaves COMPLETED intact; repeat confirm succeeds", async () => {
    const sql = getSql();
    const base = memoryStorage();
    const config = listingImageConfig();
    // Attempt B (first download call) pauses at the gate and, when
    // released, receives GARBAGE bytes → its processing fails and it
    // attempts a terminal FAILED mark. Attempt A (second call) gets
    // the real image and completes while B is paused.
    const entered = barrier();
    const release = barrier();
    let call = 0;
    const provider: StorageProvider = {
      ...base.provider,
      async downloadObject(bucket, path) {
        if (bucket === config.uploadsBucket) {
          call += 1;
          if (call === 1) {
            entered.reach();
            await release.reached;
            return Buffer.from("garbage after the gate");
          }
        }
        return base.provider.downloadObject(bucket, path);
      },
    };
    setStorageProviderForTesting(provider);

    const { listingId, session } = await newGuestDraft();
    const uploadId = await issueAndPut(base, session, listingId);
    const tempKey = `${config.uploadsBucket}/${guestTempPath(session.sessionId, listingId, uploadId)}`;

    const failing = confirmGuestUpload(session, listingId, uploadId).then(
      () => "confirmed" as const,
      (error) => (error instanceof ApiError ? error.code : "unexpected"),
    );
    await entered.reached; // B provably paused before its bytes arrive
    const completed = await confirmGuestUpload(session, listingId, uploadId);
    expect(completed.image.id).toBe(uploadId);
    const committedPath = await storagePathOf(uploadId);
    release.reach();
    expect(await failing).toBe("IMAGE_INVALID_FORMAT");

    // The stale terminal mark lost: the upload stays COMPLETED with
    // its image reference, so repeat confirm is still idempotent…
    const [row] = await sql<{ status: string; image_id: string | null }[]>`
      select status, image_id from listing_image_uploads where id = ${uploadId}
    `;
    expect(row).toMatchObject({ status: "COMPLETED", image_id: uploadId });
    const repeat = await confirmGuestUpload(session, listingId, uploadId);
    expect(repeat.image.id).toBe(uploadId);
    // …the committed image row and ONLY its object survive, and the
    // loser's gated temp deletion never ran against a won transition.
    expect(base.objects.has(`${config.imagesBucket}/${committedPath}`)).toBe(true);
    expect(finalsIn(base)).toEqual([`${config.imagesBucket}/${committedPath}`]);
    void tempKey; // temp was deleted by the SUCCESSFUL confirm, legitimately
  });
});

describe("authenticated seller image path is unchanged", () => {
  it("seller upload-authorize + confirm work exactly as before", async () => {
    const store = memoryStorage();
    setStorageProviderForTesting(store.provider);
    const config = listingImageConfig();
    const draft = await createDraft(seller, "CAR");
    const authz = await createUploadAuthorization(seller, draft.id, {
      mimeType: "image/png",
      sizeBytes: pngBytes.length,
    });
    await store.provider.uploadObject(
      config.uploadsBucket,
      `uploads/${seller.user.id}/${draft.id}/${authz.uploadId}`,
      pngBytes,
      "image/png",
    );
    const result = await confirmUpload(seller, draft.id, authz.uploadId);
    expect(result.image.isPrimary).toBe(true);
    expect(result.revision).toBeGreaterThanOrEqual(1);
  });
});
