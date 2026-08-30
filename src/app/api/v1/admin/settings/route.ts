import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseBody } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { adminSettings, updateAdminSetting } from "@/services/admin";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  await requireAdmin(request);
  return apiSuccess({ settings: await adminSettings() }, { requestId, cacheControl: "no-store" });
});

const patchSchema = z
  .object({
    key: z.string().min(1).max(64),
    value: z.number().int(),
    version: z.string().min(10).max(64),
  })
  .strict();

export const PATCH = createApiHandler(async ({ request, requestId }) => {
  assertSameOrigin(request);
  const auth = await requireAdmin(request);
  const body = await parseBody(request, patchSchema);
  const setting = await updateAdminSetting(auth, body);
  return apiSuccess({ setting }, { requestId });
});
