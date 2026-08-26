import { createHash, createHmac, randomBytes } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { seed } from "./helpers";

/**
 * E2E auth utilities. The OTP provider is a dev logger, so specs make
 * the REAL flow deterministic by rewriting the stored challenge hash
 * to a known code using the server's own scheme and the test pepper
 * from playwright.config.ts. Nothing here weakens production code.
 */

const PEPPER = "e2e-test-pepper-0123456789abcdef";
export const KNOWN_OTP = "123456";

function db() {
  return postgres(seed().databaseUrl, { prepare: false, max: 1 });
}

/** Distinct phone per (project, slot) — keeps per-phone rate limits isolated. */
export function testPhone(projectName: string, slot: number): string {
  const project = { desktop: 1, tablet: 2, mobile: 3 }[projectName] ?? 9;
  return `+9945088${project}${String(slot).padStart(4, "0")}`;
}

/**
 * Rewrites the newest OTP challenge for `phone` so KNOWN_OTP verifies.
 * Polls briefly: the browser's request may still be in flight when the
 * spec reaches this call.
 */
export async function forceOtpCode(phone: string, code = KNOWN_OTP): Promise<void> {
  const sql = db();
  try {
    let challenge: { id: string } | undefined;
    for (let attempt = 0; attempt < 60 && !challenge; attempt += 1) {
      [challenge] = await sql`
        select id from otp_challenges where phone_e164 = ${phone}
        order by created_at desc limit 1
      `;
      if (!challenge) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!challenge) throw new Error(`no otp challenge for ${phone}`);
    const hash = createHmac("sha256", PEPPER).update(`otp:v1:${challenge.id}:${code}`).digest("hex");
    await sql`update otp_challenges set code_hash = ${hash} where id = ${challenge.id}`;
  } finally {
    await sql.end();
  }
}

/**
 * Creates a user + session directly in the DB and installs the cookie —
 * for specs that need an authenticated browser without re-testing the
 * OTP flow each time.
 */
export async function loginAs(
  context: BrowserContext,
  phone: string,
  options: { blocked?: boolean; roles?: string[] } = {},
): Promise<{ userId: string }> {
  const sql = db();
  try {
    const [user] = await sql`
      insert into users (phone_e164, phone_verified_at, last_login_at)
      values (${phone}, now(), now())
      on conflict (phone_e164) do update set last_login_at = now()
      returning id
    `;
    if (options.blocked === true) {
      await sql`update users set status = 'BLOCKED', blocked_at = now() where id = ${user.id}`;
    }
    for (const role of options.roles ?? []) {
      await sql`
        insert into user_roles (user_id, role_id)
        select ${user.id}, id from roles where code = ${role}
        on conflict do nothing
      `;
    }
    await sql`
      insert into user_roles (user_id, role_id)
      select ${user.id}, id from roles where code = 'USER'
      on conflict do nothing
    `;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await sql`
      insert into sessions (user_id, token_hash, expires_at)
      values (${user.id}, ${tokenHash}, now() + interval '1 hour')
    `;
    await context.addCookies([
      { name: "avtosh_session", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    return { userId: user.id };
  } finally {
    await sql.end();
  }
}
