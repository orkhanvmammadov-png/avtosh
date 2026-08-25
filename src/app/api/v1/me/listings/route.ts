import { requireActiveSeller, requireAuth } from "@/auth/current-user";
import { createApiHandler, parseBody, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { createDraft } from "@/services/listing-drafts";
import { myListings } from "@/services/my-listings";
import { createDraftSchema, myListingsQuerySchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const body = await parseBody(request, createDraftSchema);
  const listing = await createDraft(auth, body.category);
  return apiSuccess({ listing }, { requestId, status: 201 });
});

/** Owner "My Listings" — never sourced from public search. */
export const GET = createApiHandler(async ({ request, requestId }) => {
  const auth = await requireAuth(request);
  const query = parseQuery(request, myListingsQuerySchema);
  const items = await myListings(auth, query.filter);
  return apiSuccess({ items }, { requestId, cacheControl: "no-store" });
});
