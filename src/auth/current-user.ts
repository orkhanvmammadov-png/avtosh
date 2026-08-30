import { cookies } from "next/headers";
import { authConfig } from "@/auth/config";
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

/**
 * Centralized guard for seller mutations: authenticated AND not
 * blocked. BLOCKED users keep read access to their own account
 * (/auth/me) but may not perform seller mutations (accepted business
 * rule).
 */
export async function requireActiveSeller(
  request: Request,
): Promise<AuthContext> {
  const auth = await requireAuth(request);
  if (auth.user.status === "BLOCKED") {
    throw new ApiError(
      "USER_BLOCKED",
      "Your account is blocked and cannot perform this action.",
    );
  }
  return auth;
}

export const STAFF_ROLES = ["MODERATOR", "ADMIN", "SUPER_ADMIN"] as const;

/**
 * Staff guard for moderator endpoints: authenticated, not BLOCKED
 * (a blocked account gets no staff access), and holding at least one
 * staff role. The actor is always the session user — never a body
 * field. Normal USERs receive STAFF_ROLE_REQUIRED.
 */
export const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

/** Admin-tier authorization: active (not blocked) ADMIN/SUPER_ADMIN. */
export async function requireAdmin(request: Request): Promise<AuthContext> {
  const auth = await requireActiveSeller(request);
  const isAdmin = auth.roles.some((role) =>
    (ADMIN_ROLES as readonly string[]).includes(role),
  );
  if (!isAdmin) {
    throw new ApiError("STAFF_ROLE_REQUIRED", "Admin role required.");
  }
  return auth;
}

/** SUPER_ADMIN-only operations (e.g. ADMIN role management). */
export async function requireSuperAdmin(request: Request): Promise<AuthContext> {
  const auth = await requireAdmin(request);
  if (!auth.roles.includes("SUPER_ADMIN")) {
    throw new ApiError("STAFF_ROLE_REQUIRED", "Super admin role required.");
  }
  return auth;
}

export async function requireStaff(request: Request): Promise<AuthContext> {
  const auth = await requireActiveSeller(request);
  const isStaff = auth.roles.some((role) =>
    (STAFF_ROLES as readonly string[]).includes(role),
  );
  if (!isStaff) {
    throw new ApiError("STAFF_ROLE_REQUIRED", "Staff role required.");
  }
  return auth;
}

/**
 * Server-Component variant of getCurrentAuth (no Request object in
 * RSCs): reads the session cookie via next/headers and runs the same
 * query-time validity checks. Null for anonymous visitors.
 */
export async function getCurrentAuthFromCookies(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(authConfig().sessionCookieName)?.value;
  if (token === undefined || token.length === 0) {
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
