import { authConfig } from "@/auth/config";

/**
 * Centralized session-cookie handling. The cookie carries only the
 * opaque session token — never user IDs or roles. HttpOnly +
 * SameSite=Lax always; Secure in production.
 */

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function serializeSessionCookie(
  token: string,
  maxAgeSeconds: number,
): string {
  const { sessionCookieName } = authConfig();
  const secure = isProduction() ? "; Secure" : "";
  return `${sessionCookieName}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearSessionCookie(): string {
  const { sessionCookieName } = authConfig();
  const secure = isProduction() ? "; Secure" : "";
  return `${sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

/** Extracts the raw session token from the Cookie header, if any. */
export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (header === null) {
    return null;
  }
  const { sessionCookieName } = authConfig();
  const prefix = `${sessionCookieName}=`;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
