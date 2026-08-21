import { requireStaff } from "@/auth/current-user";
import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getModerationQueue } from "@/services/moderation";
import { moderationQueueQuerySchema } from "@/validators/moderation";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  await requireStaff(request);
  const query = parseQuery(request, moderationQueueQuerySchema);
  const page = await getModerationQueue({ limit: query.limit, cursor: query.cursor });
  return apiSuccess({ items: page.items, next_cursor: page.nextCursor }, { requestId });
});
