import { GUEST_SESSION_TTL_SECONDS } from "@/lib/config/guest-drafts";

/**
 * Guest-draft capability cookie: carries ONLY the opaque token whose
 * hash lives in guest_draft_sessions. Same transport discipline as the
 * session cookie (HttpOnly, SameSite=Lax, Secure in production) — the
 * capability is server-owned; a client-supplied listing id or phone is
 * never proof of ownership.
 */

const GUEST_COOKIE_NAME = "avtosh_guest_draft";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function serializeGuestCookie(token: string): string {
  const secure = isProduction() ? "; Secure" : "";
  return `${GUEST_COOKIE_NAME}=${token}; Path=/; Max-Age=${GUEST_SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

/** Extracts the raw guest token from the Cookie header, if any. */
export function readGuestToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (header === null) {
    return null;
  }
  const prefix = `${GUEST_COOKIE_NAME}=`;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
