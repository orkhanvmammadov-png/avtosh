import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { setUserBlockedState } from "@/services/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).strict();

export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireAdmin(request);
  const userId = requireUuidParam(params, "userId");
  await parseBody(request, bodySchema);
  const user = await setUserBlockedState(auth, userId, { blocked: false, reason: null });
  return apiSuccess({ user }, { requestId });
});
