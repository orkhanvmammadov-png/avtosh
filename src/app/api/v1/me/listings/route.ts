import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, parseBody } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { createDraft } from "@/services/listing-drafts";
import { createDraftSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const body = await parseBody(request, createDraftSchema);
  const listing = await createDraft(auth, body.category);
  return apiSuccess({ listing }, { requestId, status: 201 });
});
