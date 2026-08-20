import { randomUUID } from "node:crypto";
import { authConfig, requireOtpPepper } from "@/auth/config";
import {
  generateOtpCode,
  generateSessionToken,
  hashOtp,
  hashSessionToken,
  verifyOtpHash,
} from "@/auth/otp-crypto";
import { maskPhone, normalizePhoneE164 } from "@/auth/phone";
import { ApiError } from "@/lib/api/errors";
import { getSql, withTransaction } from "@/lib/server/db/client";
import { getWhatsAppOtpProvider } from "@/providers/whatsapp/factory";
import {
  countChallengesForIpSince,
  countChallengesForPhoneSince,
  ensureUserRole,
  expirePendingChallenges,
  getChallengeForUpdate,
  getUserRoleCodes,
  insertChallenge,
  insertSession,
  markChallengeExpired,
  markChallengeVerified,
  recordFailedAttempt,
  revokeSessionByTokenHash,
  rotateChallengeOtp,
  upsertUserOnLogin,
  type UserRow,
} from "@/repositories/auth";

const OTP_PURPOSE = "LOGIN";

export interface OtpChallengeResult {
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface AuthenticatedUserDto {
  id: string;
  displayName: string | null;
  phoneMasked: string;
  status: "ACTIVE" | "BLOCKED";
  roles: string[];
}

export interface VerifyResult {
  user: AuthenticatedUserDto;
  sessionToken: string;
  sessionTtlSeconds: number;
}

export function toUserDto(user: UserRow, roles: string[]): AuthenticatedUserDto {
  return {
    id: user.id,
    displayName: user.display_name,
    phoneMasked: maskPhone(user.phone_e164),
    status: user.status,
    roles,
  };
}

/**
 * OTP request: normalize → rate-limit → supersede prior PENDING
 * challenges → create hashed challenge → deliver via provider.
 * Delivery happens AFTER the transaction commits (never hold a DB
 * transaction across a network call); a definitive delivery failure
 * expires the challenge so no undeliverable-but-usable challenge
 * remains. The response is identical for new and existing phones.
 */
export async function requestOtp(input: {
  phone: string;
  ipHash: string | null;
}): Promise<OtpChallengeResult> {
  const phone = normalizePhoneE164(input.phone);
  if (phone === null) {
    throw new ApiError("AUTH_INVALID_PHONE", "Invalid phone number.");
  }
  const cfg = authConfig();
  const pepper = requireOtpPepper();

  await enforceRequestLimits(phone, input.ipHash);

  const challengeId = randomUUID();
  const code = generateOtpCode();
  const codeHash = hashOtp(pepper, challengeId, code);
  const expiresAt = new Date(Date.now() + cfg.otpTtlSeconds * 1000);

  await withTransaction(async (tx) => {
    await expirePendingChallenges(tx, phone, OTP_PURPOSE);
    await insertChallenge(tx, {
      id: challengeId,
      phoneE164: phone,
      purpose: OTP_PURPOSE,
      codeHash,
      expiresAt,
      maxAttempts: cfg.otpMaxAttempts,
      ipHash: input.ipHash,
    });
  });

  await deliverOtp(challengeId, phone, code);

  return {
    challengeId,
    expiresInSeconds: cfg.otpTtlSeconds,
    resendAfterSeconds: cfg.otpResendCooldownSeconds,
  };
}

/**
 * Challenge-based resend: rotates the OTP inside the existing
 * challenge (decision A). The old code becomes unusable immediately;
 * attempt counting stays cumulative; cooldown and resend limits are
 * enforced from last_sent_at / resend_count.
 */
export async function resendOtp(input: {
  challengeId: string;
}): Promise<OtpChallengeResult> {
  const cfg = authConfig();
  const pepper = requireOtpPepper();

  const code = generateOtpCode();
  const newHash = hashOtp(pepper, input.challengeId, code);

  const phone = await withTransaction(async (tx) => {
    const challenge = await getChallengeForUpdate(tx, input.challengeId);
    if (challenge === undefined || challenge.status === "VERIFIED") {
      throw new ApiError("OTP_INVALID", "Verification challenge is not usable.");
    }
    if (challenge.status === "LOCKED") {
      throw new ApiError("OTP_LOCKED", "Too many attempts. Request a new code.");
    }
    if (
      challenge.status === "EXPIRED" ||
      challenge.expires_at.getTime() <= Date.now()
    ) {
      throw new ApiError("OTP_EXPIRED", "The code has expired. Request a new one.");
    }
    const nextAllowedAt =
      challenge.last_sent_at.getTime() + cfg.otpResendCooldownSeconds * 1000;
    if (nextAllowedAt > Date.now()) {
      throw new ApiError(
        "OTP_RESEND_TOO_SOON",
        "Please wait before requesting another code.",
        { details: { retry_after_seconds: Math.ceil((nextAllowedAt - Date.now()) / 1000) } },
      );
    }
    if (challenge.resend_count >= cfg.otpMaxResends) {
      throw new ApiError(
        "OTP_RATE_LIMITED",
        "Resend limit reached. Request a new code later.",
      );
    }
    await rotateChallengeOtp(tx, challenge.id, newHash);
    return challenge.phone_e164;
  });

  await deliverOtp(input.challengeId, phone, code);

  return {
    challengeId: input.challengeId,
    expiresInSeconds: Math.max(
      0,
      Math.ceil(
        ((await remainingTtlMs(input.challengeId)) ?? 0) / 1000,
      ),
    ),
    resendAfterSeconds: cfg.otpResendCooldownSeconds,
  };
}

/**
 * OTP verification. The whole state transition — challenge
 * consumption, user find-or-create, role assignment, session creation
 * — runs in ONE transaction with the challenge row locked (FOR
 * UPDATE), so concurrent verifications serialize: exactly one can
 * consume the challenge; the loser sees VERIFIED and fails. Failed
 * attempts are committed (return-not-throw) so brute-force counting
 * survives.
 */
export async function verifyOtp(input: {
  challengeId: string;
  otp: string;
  presentedSessionToken: string | null;
}): Promise<VerifyResult> {
  const cfg = authConfig();
  const pepper = requireOtpPepper();
  const sql = getSql();

  type TxOutcome =
    | { failure: "OTP_INVALID" | "OTP_EXPIRED" | "OTP_LOCKED" }
    | { success: { user: UserRow; roles: string[]; sessionToken: string } };

  const outcome = await withTransaction(async (tx): Promise<TxOutcome> => {
    const challenge = await getChallengeForUpdate(tx, input.challengeId);
    if (challenge === undefined || challenge.status === "VERIFIED") {
      return { failure: "OTP_INVALID" };
    }
    if (challenge.status === "LOCKED") {
      return { failure: "OTP_LOCKED" };
    }
    // Correctness relies on expires_at, not on cleanup having run.
    if (
      challenge.status === "EXPIRED" ||
      challenge.expires_at.getTime() <= Date.now()
    ) {
      return { failure: "OTP_EXPIRED" };
    }
    const valid = verifyOtpHash(
      pepper,
      challenge.id,
      input.otp,
      challenge.code_hash,
    );
    if (!valid) {
      const attempts = challenge.attempt_count + 1;
      const locked = attempts >= challenge.max_attempts;
      await recordFailedAttempt(tx, challenge.id, attempts, locked);
      return { failure: locked ? "OTP_LOCKED" : "OTP_INVALID" };
    }

    await markChallengeVerified(tx, challenge.id);
    const user = await upsertUserOnLogin(tx, challenge.phone_e164);
    await ensureUserRole(tx, user.id, "USER");
    const roles = await getUserRoleCodes(tx, user.id);

    const sessionToken = generateSessionToken();
    await insertSession(tx, {
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(Date.now() + cfg.sessionTtlSeconds * 1000),
    });
    return { success: { user, roles, sessionToken } };
  });

  if ("failure" in outcome) {
    const messages = {
      OTP_INVALID: "Invalid verification code.",
      OTP_EXPIRED: "The code has expired. Request a new one.",
      OTP_LOCKED: "Too many attempts. Request a new code.",
    } as const;
    throw new ApiError(outcome.failure, messages[outcome.failure]);
  }

  // Session fixation defense: any previously presented session is
  // revoked; authentication always yields a fresh token.
  if (input.presentedSessionToken !== null) {
    await revokeSessionByTokenHash(
      sql,
      hashSessionToken(input.presentedSessionToken),
    );
  }

  return {
    user: toUserDto(outcome.success.user, outcome.success.roles),
    sessionToken: outcome.success.sessionToken,
    sessionTtlSeconds: cfg.sessionTtlSeconds,
  };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  await revokeSessionByTokenHash(getSql(), hashSessionToken(token));
}

// --- internals --------------------------------------------------------------

async function enforceRequestLimits(
  phone: string,
  ipHash: string | null,
): Promise<void> {
  const cfg = authConfig();
  const sql = getSql();
  const hourAgo = new Date(Date.now() - 3_600_000);

  if (cfg.otpMinIntervalSeconds > 0) {
    const recent = await countChallengesForPhoneSince(
      sql,
      phone,
      new Date(Date.now() - cfg.otpMinIntervalSeconds * 1000),
    );
    if (recent > 0) {
      throw new ApiError(
        "OTP_RATE_LIMITED",
        "Please wait before requesting another code.",
        { details: { retry_after_seconds: cfg.otpMinIntervalSeconds } },
      );
    }
  }
  const phoneCount = await countChallengesForPhoneSince(sql, phone, hourAgo);
  if (phoneCount >= cfg.otpPhoneMaxPerHour) {
    throw new ApiError("OTP_RATE_LIMITED", "Too many requests. Try again later.");
  }
  if (ipHash !== null) {
    const ipCount = await countChallengesForIpSince(sql, ipHash, hourAgo);
    if (ipCount >= cfg.otpIpMaxPerHour) {
      throw new ApiError("OTP_RATE_LIMITED", "Too many requests. Try again later.");
    }
  }
}

async function deliverOtp(
  challengeId: string,
  phone: string,
  code: string,
): Promise<void> {
  try {
    await getWhatsAppOtpProvider().sendOtp({ phoneE164: phone, code });
  } catch {
    // Definitive delivery failure: never leave a usable challenge the
    // user can't receive. Provider internals are not exposed.
    await markChallengeExpired(getSql(), challengeId);
    throw new ApiError(
      "INTERNAL_ERROR",
      "Could not send the verification code. Please try again.",
      { status: 502 },
    );
  }
}

async function remainingTtlMs(challengeId: string): Promise<number | null> {
  const sql = getSql();
  const rows = await sql<{ expires_at: Date }[]>`
    select expires_at from otp_challenges where id = ${challengeId}
  `;
  return rows[0] ? rows[0].expires_at.getTime() - Date.now() : null;
}
