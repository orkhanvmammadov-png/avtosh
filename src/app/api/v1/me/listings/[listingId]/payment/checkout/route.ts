import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { createListingFeeCheckout } from "@/services/payment-checkout";

export const dynamic = "force-dynamic";

/**
 * Creates (or reuses) the Kapital Bank checkout for the listing's
 * LISTING_FEE intent. The browser sends NOTHING but the listing id —
 * amount, currency, and provider order identity are server-resolved.
 * The response is a single opaque checkout_url; provider credentials
 * and order passwords are never exposed as separate fields.
 */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const result = await createListingFeeCheckout(auth, listingId);
  return apiSuccess({ checkout_url: result.checkoutUrl }, { requestId, cacheControl: "no-store" });
});
