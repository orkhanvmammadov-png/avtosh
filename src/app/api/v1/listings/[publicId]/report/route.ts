import { z } from "zod";
import { clientIpHash } from "@/auth/ip";
import { ApiError } from "@/lib/api/errors";
import { createApiHandler, parseBody } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { REPORT_REASON_CODES, submitListingReport } from "@/services/reports";
import { publicIdParamSchema } from "@/validators/marketplace";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    reason_code: z.enum(REPORT_REASON_CODES),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/**
 * Anonymous listing report intake. Uniform 404 for anything not
 * publicly reachable (no hidden-listing oracle); rate limited per
 * hashed source; the response body is intentionally empty — no
 * report id or processing metadata ever leaves the server.
 */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  const parsed = publicIdParamSchema.safeParse(params.publicId);
  if (!parsed.success) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  const body = await parseBody(request, bodySchema);
  await submitListingReport(parsed.data, clientIpHash(request), {
    reasonCode: body.reason_code,
    note: body.note === undefined || body.note.length === 0 ? null : body.note,
  });
  return apiSuccess({ accepted: true }, { requestId, cacheControl: "no-store" });
});
