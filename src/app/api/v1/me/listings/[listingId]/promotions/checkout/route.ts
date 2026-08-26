import { z } from "zod";
import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { createPromotionCheckout } from "@/services/promotion-purchases";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    type: z.enum(["PREMIUM", "BOOST"]),
    package_id: z.uuid(),
  })
  .strict();

/**
 * Creates/reuses the promotion purchase intent and its Kapital
 * checkout. The browser chooses only type + package identifier —
 * price, currency, and duration are resolved server-side and frozen
 * into the intent snapshot. Response is one opaque checkout_url.
 */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, bodySchema);
  const result = await createPromotionCheckout(auth, listingId, {
    type: body.type,
    packageId: body.package_id,
  });
  return apiSuccess({ checkout_url: result.checkoutUrl }, { requestId, cacheControl: "no-store" });
});
