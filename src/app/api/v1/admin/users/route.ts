import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { adminUsers } from "@/services/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  phone: z.string().regex(/^[+0-9]{2,16}$/).optional(),
  cursor: z.string().max(300).optional(),
});

export const GET = createApiHandler(async ({ request, requestId }) => {
  await requireAdmin(request);
  const query = parseQuery(request, querySchema);
  const result = await adminUsers(query);
  return apiSuccess(result, { requestId, cacheControl: "no-store" });
});
