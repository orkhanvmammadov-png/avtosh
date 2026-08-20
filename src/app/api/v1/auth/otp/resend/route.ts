import { createApiHandler, parseBody } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { resendOtp } from "@/services/auth";
import { otpResendSchema } from "@/validators/auth";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId }) => {
  const body = await parseBody(request, otpResendSchema);
  const result = await resendOtp({ challengeId: body.challenge_id });
  return apiSuccess(
    {
      challenge_id: result.challengeId,
      expires_in_seconds: result.expiresInSeconds,
      resend_after_seconds: result.resendAfterSeconds,
    },
    { requestId },
  );
});
