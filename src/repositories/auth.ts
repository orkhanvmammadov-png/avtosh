import type { Sql } from "@/lib/server/db/client";

/**
 * Auth repository — parameterized SQL only. Every function takes the
 * database handle explicitly so services can run multi-step flows
 * inside one transaction (postgres.js transaction handles satisfy the
 * same Sql interface).
 */

export interface OtpChallengeRow {
  id: string;
  phone_e164: string;
  purpose: string;
  code_hash: string;
  status: "PENDING" | "VERIFIED" | "EXPIRED" | "LOCKED";
  expires_at: Date;
  attempt_count: number;
  max_attempts: number;
  resend_count: number;
  last_sent_at: Date;
  created_at: Date;
}

export interface UserRow {
  id: string;
  phone_e164: string;
  display_name: string | null;
  status: "ACTIVE" | "BLOCKED";
}

export interface SessionWithUserRow {
  session_id: string;
  user_id: string;
  last_seen_at: Date | null;
  phone_e164: string;
  display_name: string | null;
  status: "ACTIVE" | "BLOCKED";
}

// --- OTP challenges ---------------------------------------------------------

export async function expirePendingChallenges(
  sql: Sql,
  phoneE164: string,
  purpose: string,
): Promise<void> {
  await sql`
    update otp_challenges
    set status = 'EXPIRED'
    where phone_e164 = ${phoneE164} and purpose = ${purpose} and status = 'PENDING'
  `;
}

export async function insertChallenge(
  sql: Sql,
  input: {
    id: string;
    phoneE164: string;
    purpose: string;
    codeHash: string;
    expiresAt: Date;
    maxAttempts: number;
    ipHash: string | null;
  },
): Promise<void> {
  await sql`
    insert into otp_challenges
      (id, phone_e164, purpose, code_hash, expires_at, max_attempts, ip_hash)
    values
      (${input.id}, ${input.phoneE164}, ${input.purpose}, ${input.codeHash},
       ${input.expiresAt}, ${input.maxAttempts}, ${input.ipHash})
  `;
}

export async function countChallengesForPhoneSince(
  sql: Sql,
  phoneE164: string,
  since: Date,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from otp_challenges
    where phone_e164 = ${phoneE164} and created_at > ${since}
  `;
  return Number(rows[0].count);
}

export async function countChallengesForIpSince(
  sql: Sql,
  ipHash: string,
  since: Date,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from otp_challenges
    where ip_hash = ${ipHash} and created_at > ${since}
  `;
  return Number(rows[0].count);
}

/** Locks the challenge row for the duration of the transaction. */
export async function getChallengeForUpdate(
  sql: Sql,
  id: string,
): Promise<OtpChallengeRow | undefined> {
  const rows = await sql<OtpChallengeRow[]>`
    select id, phone_e164, purpose, code_hash, status, expires_at,
           attempt_count, max_attempts, resend_count, last_sent_at, created_at
    from otp_challenges
    where id = ${id}
    for update
  `;
  return rows[0];
}

export async function recordFailedAttempt(
  sql: Sql,
  id: string,
  newAttemptCount: number,
  lock: boolean,
): Promise<void> {
  await sql`
    update otp_challenges
    set attempt_count = ${newAttemptCount},
        status = ${lock ? "LOCKED" : "PENDING"}::otp_status
    where id = ${id}
  `;
}

export async function markChallengeVerified(
  sql: Sql,
  id: string,
): Promise<void> {
  await sql`
    update otp_challenges
    set status = 'VERIFIED', verified_at = now()
    where id = ${id}
  `;
}

export async function markChallengeExpired(sql: Sql, id: string): Promise<void> {
  await sql`
    update otp_challenges set status = 'EXPIRED' where id = ${id}
  `;
}

export async function rotateChallengeOtp(
  sql: Sql,
  id: string,
  newCodeHash: string,
): Promise<void> {
  await sql`
    update otp_challenges
    set code_hash = ${newCodeHash},
        resend_count = resend_count + 1,
        last_sent_at = now()
    where id = ${id}
  `;
}

// --- users / roles ----------------------------------------------------------

/**
 * Find-or-create by normalized phone in one atomic statement. The
 * UNIQUE phone constraint plus ON CONFLICT guarantees exactly one row
 * even under concurrent verifications.
 */
export async function upsertUserOnLogin(
  sql: Sql,
  phoneE164: string,
): Promise<UserRow> {
  const rows = await sql<UserRow[]>`
    insert into users (phone_e164, phone_verified_at, last_login_at)
    values (${phoneE164}, now(), now())
    on conflict (phone_e164) do update
      set last_login_at = now(),
          phone_verified_at = coalesce(users.phone_verified_at, now())
    returning id, phone_e164, display_name, status
  `;
  return rows[0];
}

export async function ensureUserRole(
  sql: Sql,
  userId: string,
  roleCode: string,
): Promise<void> {
  await sql`
    insert into user_roles (user_id, role_id)
    select ${userId}, id from roles where code = ${roleCode}
    on conflict do nothing
  `;
}

export async function getUserRoleCodes(
  sql: Sql,
  userId: string,
): Promise<string[]> {
  const rows = await sql<{ code: string }[]>`
    select r.code
    from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = ${userId}
    order by r.code
  `;
  return rows.map((row) => row.code);
}

// --- sessions ---------------------------------------------------------------

export async function insertSession(
  sql: Sql,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into sessions (user_id, token_hash, expires_at)
    values (${input.userId}, ${input.tokenHash}, ${input.expiresAt})
    returning id
  `;
  return rows[0].id;
}

/**
 * Active-session lookup. Security correctness lives in this WHERE
 * clause — revoked_at IS NULL AND expires_at > now() — never in
 * cleanup jobs.
 */
export async function findActiveSessionWithUser(
  sql: Sql,
  tokenHash: string,
): Promise<SessionWithUserRow | undefined> {
  const rows = await sql<SessionWithUserRow[]>`
    select s.id as session_id, s.last_seen_at,
           u.id as user_id, u.phone_e164, u.display_name, u.status
    from sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash}
      and s.revoked_at is null
      and s.expires_at > now()
  `;
  return rows[0];
}

export async function revokeSessionByTokenHash(
  sql: Sql,
  tokenHash: string,
): Promise<void> {
  await sql`
    update sessions
    set revoked_at = now()
    where token_hash = ${tokenHash} and revoked_at is null
  `;
}

/** Throttled: writes at most once per 5 minutes per session. */
export async function touchSessionLastSeen(
  sql: Sql,
  sessionId: string,
): Promise<void> {
  await sql`
    update sessions
    set last_seen_at = now()
    where id = ${sessionId}
      and (last_seen_at is null or last_seen_at < now() - interval '5 minutes')
  `;
}
