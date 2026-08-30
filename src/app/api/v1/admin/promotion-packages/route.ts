import { z } from "zod";
import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, parseBody } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { adminPackages, updatePromotionPackage } from "@/services/admin";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  await requireAdmin(request);
  return apiSuccess({ packages: await adminPackages() }, { requestId, cacheControl: "no-store" });
});

const patchSchema = z
  .object({
    package_id: z.uuid(),
    version: z.string().min(10).max(64),
    price_minor: z.number().int().min(1).max(100_000_000).optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.price_minor !== undefined || v.is_active !== undefined, "Nothing to change.");

export const PATCH = createApiHandler(async ({ request, requestId }) => {
  assertSameOrigin(request);
  const auth = await requireAdmin(request);
  const body = await parseBody(request, patchSchema);
  const pkg = await updatePromotionPackage(auth, body.package_id, {
    version: body.version,
    priceMinor: body.price_minor,
    isActive: body.is_active,
  });
  return apiSuccess({ package: pkg }, { requestId });
});
