import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { resolveAdminReport } from "@/services/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ status: z.enum(["RESOLVED", "DISMISSED"]) }).strict();

export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireAdmin(request);
  const reportId = requireUuidParam(params, "reportId");
  const body = await parseBody(request, bodySchema);
  const result = await resolveAdminReport(auth, reportId, body.status);
  return apiSuccess(result, { requestId });
});
