import { z } from "zod";
import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { createRenewalCheckout } from "@/services/renewals";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).strict();

/**
 * Creates/reuses THE renewal intent and its Kapital checkout. The
 * browser sends nothing but the listing id — fee and duration are
 * resolved from server settings and frozen into the intent snapshot.
 */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  await parseBody(request, bodySchema);
  const result = await createRenewalCheckout(auth, listingId);
  return apiSuccess({ checkout_url: result.checkoutUrl }, { requestId, cacheControl: "no-store" });
});
