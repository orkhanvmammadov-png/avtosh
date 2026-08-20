import { clientIpHash } from "@/auth/ip";
import { createApiHandler, parseBody } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { requestOtp } from "@/services/auth";
import { otpRequestSchema } from "@/validators/auth";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId }) => {
  const body = await parseBody(request, otpRequestSchema);
  const result = await requestOtp({
    phone: body.phone,
    ipHash: clientIpHash(request),
  });
  return apiSuccess(
    {
      challenge_id: result.challengeId,
      expires_in_seconds: result.expiresInSeconds,
      resend_after_seconds: result.resendAfterSeconds,
    },
    { requestId },
  );
});
