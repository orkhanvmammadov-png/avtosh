import { requireActiveSeller } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import {
  createOrGetEditView,
  getEditView,
  updateEditRevision,
} from "@/services/listing-edit";
import { editPatchSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

/** O.12 create-or-get THE open edit revision (Stage A core: snapshot,
    one-open-per-listing arbitration, audit, outbox). */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const view = await createOrGetEditView(auth, listingId);
  return apiSuccess(view, { requestId });
});

/** Current open revision as the editor view — never creates one. */
export const GET = createApiHandler(async ({ request, requestId, params }) => {
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const view = await getEditView(auth, listingId);
  if (view === null) {
    throw new ApiError("LISTING_LIFECYCLE_CONFLICT", "No open edit revision.");
  }
  return apiSuccess(view, { requestId });
});

/** Revision autosave — edit-revision-counter optimistic concurrency. */
export const PATCH = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, editPatchSchema);
  const view = await updateEditRevision(auth, listingId, body);
  return apiSuccess(view, { requestId });
});
