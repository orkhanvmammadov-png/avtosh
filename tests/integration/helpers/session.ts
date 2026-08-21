import { generateSessionToken, hashSessionToken } from "@/auth/otp-crypto";
import { getSql } from "@/lib/server/db/client";
import {
  ensureUserRole,
  insertSession,
  upsertUserOnLogin,
} from "@/repositories/auth";

/**
 * Creates a user + session directly through the accepted auth
 * repositories (bypassing the OTP dance, which has its own tests).
 */
export async function createTestUserSession(
  phone: string,
  options: { blocked?: boolean; roles?: string[] } = {},
): Promise<{ userId: string; cookie: string; token: string }> {
  const sql = getSql();
  const user = await upsertUserOnLogin(sql, phone);
  await ensureUserRole(sql, user.id, "USER");
  for (const role of options.roles ?? []) {
    await ensureUserRole(sql, user.id, role);
  }
  if (options.blocked === true) {
    await sql`
      update users set status = 'BLOCKED', blocked_at = now()
      where id = ${user.id}
    `;
  }
  const token = generateSessionToken();
  await insertSession(sql, {
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { userId: user.id, cookie: `avtosh_session=${token}`, token };
}
