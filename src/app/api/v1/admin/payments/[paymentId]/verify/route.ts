import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { verifyProviderPayment } from "@/services/payment-checkout";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).strict();

/** Reuses the ONE accepted Kapital verification/fulfillment path. */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  await requireAdmin(request);
  const paymentId = requireUuidParam(params, "paymentId");
  await parseBody(request, bodySchema);
  const outcome = await verifyProviderPayment(paymentId);
  return apiSuccess({ outcome: outcome.state }, { requestId });
});
