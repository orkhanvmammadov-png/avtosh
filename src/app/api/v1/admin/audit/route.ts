import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { adminAudit } from "@/services/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  action: z.string().regex(/^[A-Z_]{1,64}$/).optional(),
  entity_id: z.string().max(100).optional(),
  actor_type: z.enum(["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN", "SYSTEM"]).optional(),
  cursor: z.string().max(300).optional(),
});

export const GET = createApiHandler(async ({ request, requestId }) => {
  await requireAdmin(request);
  const query = parseQuery(request, querySchema);
  const result = await adminAudit({
    action: query.action,
    entityId: query.entity_id,
    actorType: query.actor_type,
    cursor: query.cursor,
  });
  return apiSuccess(result, { requestId, cacheControl: "no-store" });
});
