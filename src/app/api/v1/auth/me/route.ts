import { requireAuth } from "@/auth/current-user";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { toUserDto } from "@/services/auth";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  const auth = await requireAuth(request);
  return apiSuccess({ user: toUserDto(auth.user, auth.roles) }, { requestId });
});
