import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { setUserBlockedState } from "@/services/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict();

export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireAdmin(request);
  const userId = requireUuidParam(params, "userId");
  const body = await parseBody(request, bodySchema);
  const user = await setUserBlockedState(auth, userId, { blocked: true, reason: body.reason ?? null });
  return apiSuccess({ user }, { requestId });
});
