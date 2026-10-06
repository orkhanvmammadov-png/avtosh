import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestOtp, resendOtp, verifyOtp } from "@/services/auth";
import {
  createMemoryWhatsAppProvider,
  type MemoryWhatsAppProvider,
} from "@/providers/whatsapp/memory-provider";
import { setWhatsAppOtpProviderForTesting } from "@/providers/whatsapp/factory";
import { closeSql, getSql } from "@/lib/server/db/client";
import { ApiError } from "@/lib/api/errors";

/**
 * Delivery-failure recovery semantics (verified for the MSM
 * integration): when the SMS provider definitively fails, the
 * challenge is EXPIRED — resend and verify on it are dead ends by
 * design — and the usable recovery path is a FRESH request, which
 * stays subject to OTP_MIN_INTERVAL_SECONDS and the hourly quota
 * (the failed challenge still counts: delivery failures cannot be
 * used to grind the rate limits).
 */

const PHONE = "+994553009911";
let provider: MemoryWhatsAppProvider;

async function expectApiError(promise: Promise<unknown>, code: string): Promise<ApiError> {
  let caught: unknown;
  await promise.catch((e) => (caught = e));
  expect(caught).toBeInstanceOf(ApiError);
  expect((caught as ApiError).code).toBe(code);
  return caught as ApiError;
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  provider = createMemoryWhatsAppProvider();
  setWhatsAppOtpProviderForTesting(provider);
});

afterAll(async () => {
  setWhatsAppOtpProviderForTesting(null);
  await closeSql();
});

describe("OTP delivery failure leaves a safe, usable recovery path", () => {
  it("expires the challenge, blocks resend/verify on it, rate-limits then allows a fresh request", async () => {
    process.env.OTP_MIN_INTERVAL_SECONDS = "60";
    try {
      // 1. Delivery fails definitively → request surfaces a generic
      //    502 and the challenge is EXPIRED in the database.
      provider.failNext = true;
      const failure = await expectApiError(
        requestOtp({ phone: PHONE, ipHash: "msm-recovery-ip" }),
        "INTERNAL_ERROR",
      );
      expect(failure.status).toBe(502);
      const sql = getSql();
      const [challenge] = await sql<{ id: string; status: string }[]>`
        select id, status from otp_challenges
        where phone_e164 = ${PHONE} order by created_at desc limit 1
      `;
      expect(challenge?.status).toBe("EXPIRED");

      // 2. Resend does NOT revive it — OTP_EXPIRED directs the user
      //    to request a new code (correcting the audit's assumption
      //    that resend is the recovery path).
      await expectApiError(resendOtp({ challengeId: challenge!.id }), "OTP_EXPIRED");
      // Verify on it is equally dead, whatever is typed.
      await expectApiError(
        verifyOtp({ challengeId: challenge!.id, otp: "000000", presentedSessionToken: null }),
        "OTP_EXPIRED",
      );

      // 3. The failed challenge still counts toward the min interval:
      //    an immediate fresh request is rate-limited, not free.
      const limited = await expectApiError(
        requestOtp({ phone: PHONE, ipHash: "msm-recovery-ip" }),
        "OTP_RATE_LIMITED",
      );
      expect(limited.details).toMatchObject({ retry_after_seconds: 60 });

      // 4. After the interval (0 for the test), a fresh request
      //    succeeds end to end: new challenge, delivered code,
      //    verification, session.
      process.env.OTP_MIN_INTERVAL_SECONDS = "0";
      const fresh = await requestOtp({ phone: PHONE, ipHash: "msm-recovery-ip" });
      expect(fresh.challengeId).not.toBe(challenge!.id);
      const code = provider.lastCodeFor(PHONE);
      expect(code).toBeDefined();
      const verified = await verifyOtp({
        challengeId: fresh.challengeId,
        otp: code!,
        presentedSessionToken: null,
      });
      expect(verified.sessionToken.length).toBeGreaterThan(20);
      expect(verified.user.phoneMasked).not.toContain("5530099");
    } finally {
      delete process.env.OTP_MIN_INTERVAL_SECONDS;
    }
  });
});
