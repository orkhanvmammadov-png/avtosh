import { readSessionToken } from "@/auth/cookies";
import { serializeSessionCookie } from "@/auth/cookies";
import { createApiHandler, parseBody } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { sanitizeReturnTo } from "@/lib/security/return-to";
import { verifyOtp } from "@/services/auth";
import { otpVerifySchema } from "@/validators/auth";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId }) => {
  const body = await parseBody(request, otpVerifySchema);
  const result = await verifyOtp({
    challengeId: body.challenge_id,
    otp: body.otp,
    presentedSessionToken: readSessionToken(request),
  });
  return apiSuccess(
    {
      user: result.user,
      return_to: sanitizeReturnTo(body.return_to),
    },
    {
      requestId,
      setCookie: serializeSessionCookie(
        result.sessionToken,
        result.sessionTtlSeconds,
      ),
    },
  );
});
