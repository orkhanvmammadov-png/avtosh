import { notFound, redirect } from "next/navigation";
import {
  getCurrentAuthFromCookies,
  STAFF_ROLES,
  type AuthContext,
} from "@/auth/current-user";

/**
 * Server-side page guard for the staff namespace. Anonymous visitors
 * round-trip through login; authenticated non-staff and BLOCKED staff
 * receive a plain 404 — the portal's existence is not confirmed to
 * anyone the backend would reject anyway (every API call re-checks
 * via requireStaff regardless).
 */
export async function requireStaffPage(returnTo: string): Promise<AuthContext> {
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    redirect(`/giris?return_to=${encodeURIComponent(returnTo)}`);
  }
  const isStaff = auth.roles.some((role) => (STAFF_ROLES as readonly string[]).includes(role));
  if (!isStaff || auth.user.status === "BLOCKED") {
    notFound();
  }
  return auth;
}

export function staffRoleLabel(roles: string[]): string {
  if (roles.includes("SUPER_ADMIN") || roles.includes("ADMIN")) return "Admin";
  return "Moderator";
}
