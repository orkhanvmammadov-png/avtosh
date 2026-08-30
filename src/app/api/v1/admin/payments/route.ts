import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { adminPayments } from "@/services/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["CREATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED", "REFUNDED"]).optional(),
  type: z.enum(["LISTING_FEE", "RENEWAL", "BOOST", "PREMIUM"]).optional(),
  cursor: z.string().max(300).optional(),
});

export const GET = createApiHandler(async ({ request, requestId }) => {
  await requireAdmin(request);
  const query = parseQuery(request, querySchema);
  return apiSuccess(await adminPayments(query), { requestId, cacheControl: "no-store" });
});
