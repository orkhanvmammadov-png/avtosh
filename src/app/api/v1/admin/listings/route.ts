import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { adminListings } from "@/services/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["DRAFT","PAYMENT_REQUIRED","PAYMENT_COMPLETED","PENDING_MODERATION","CORRECTION_REQUIRED","REJECTED","ACTIVE","SUSPENDED","SOLD","EXPIRED","DELETED"]).optional(),
  category: z.enum(["CAR", "MOTORCYCLE"]).optional(),
  public_id: z.string().regex(/^[0-9]{1,12}$/).optional(),
  owner_phone: z.string().regex(/^[+0-9]{2,16}$/).optional(),
  cursor: z.string().max(300).optional(),
});

export const GET = createApiHandler(async ({ request, requestId }) => {
  await requireAdmin(request);
  const query = parseQuery(request, querySchema);
  const result = await adminListings({
    status: query.status,
    category: query.category,
    publicId: query.public_id,
    ownerPhone: query.owner_phone,
    cursor: query.cursor,
  });
  return apiSuccess(result, { requestId, cacheControl: "no-store" });
});
