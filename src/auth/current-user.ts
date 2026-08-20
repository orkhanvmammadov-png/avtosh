import { readSessionToken } from "@/auth/cookies";
import { hashSessionToken } from "@/auth/otp-crypto";
import { ApiError } from "@/lib/api/errors";
import { getSql } from "@/lib/server/db/client";
import {
  findActiveSessionWithUser,
  getUserRoleCodes,
  touchSessionLastSeen,
  type UserRow,
} from "@/repositories/auth";

/**
 * Reusable server-only session authentication. Validity always
 * requires revoked_at IS NULL AND expires_at > now() at query time —
 * cleanup jobs are an optimization, never a security dependency.
 */

export interface AuthContext {
  sessionId: string;
  user: UserRow;
  roles: string[];
}

export async function getCurrentAuth(
  request: Request,
): Promise<AuthContext | null> {
  const token = readSessionToken(request);
  if (token === null) {
    return null;
  }
  const sql = getSql();
  const row = await findActiveSessionWithUser(sql, hashSessionToken(token));
  if (row === undefined) {
    return null;
  }
  await touchSessionLastSeen(sql, row.session_id);
  const roles = await getUserRoleCodes(sql, row.user_id);
  return {
    sessionId: row.session_id,
    user: {
      id: row.user_id,
      phone_e164: row.phone_e164,
      display_name: row.display_name,
      status: row.status,
    },
    roles,
  };
}

/**
 * Throws AUTH_REQUIRED when unauthenticated. Note: a BLOCKED user IS
 * authenticated — blocked-state restrictions apply to specific
 * protected mutations (listings, payments, promotions) in later
 * phases, using the status carried in this context.
 */
export async function requireAuth(request: Request): Promise<AuthContext> {
  const auth = await getCurrentAuth(request);
  if (auth === null) {
    throw new ApiError("AUTH_REQUIRED", "Authentication required.");
  }
  return auth;
}
