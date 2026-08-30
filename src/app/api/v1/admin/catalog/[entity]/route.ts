import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseBody } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { adminCatalog, setAdminCatalogActive } from "@/services/admin";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId, params }) => {
  await requireAdmin(request);
  const entity = params.entity ?? "";
  return apiSuccess({ items: await adminCatalog(entity) }, { requestId, cacheControl: "no-store" });
});

const toggleSchema = z.object({ id: z.uuid(), is_active: z.boolean() }).strict();

export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireAdmin(request);
  const entity = params.entity ?? "";
  const body = await parseBody(request, toggleSchema);
  const result = await setAdminCatalogActive(auth, entity, body.id, body.is_active);
  return apiSuccess(result, { requestId });
});
