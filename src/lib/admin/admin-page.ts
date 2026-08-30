import { notFound, redirect } from "next/navigation";
import {
  ADMIN_ROLES,
  getCurrentAuthFromCookies,
  type AuthContext,
} from "@/auth/current-user";

/**
 * Server-side page guard for the /admin namespace. Anonymous visitors
 * round-trip through login; USER, MODERATOR, and BLOCKED accounts get
 * a plain 404 (no existence disclosure). Every admin API re-checks
 * authorization independently via requireAdmin/requireSuperAdmin.
 */
export async function requireAdminPage(returnTo: string): Promise<AuthContext> {
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    redirect(`/giris?return_to=${encodeURIComponent(returnTo)}`);
  }
  const isAdmin = auth.roles.some((role) => (ADMIN_ROLES as readonly string[]).includes(role));
  if (!isAdmin || auth.user.status === "BLOCKED") {
    notFound();
  }
  return auth;
}

export function isSuperAdmin(auth: AuthContext): boolean {
  return auth.roles.includes("SUPER_ADMIN");
}
