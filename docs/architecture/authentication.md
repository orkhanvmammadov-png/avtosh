# Authentication & Sessions (Phase 4.4)

Date: 2026-08-20
Status: implemented (production WhatsApp delivery pending)

Passwordless, phone-first authentication. Registration and login are
one flow: phone → WhatsApp OTP → verify → find-or-create user →
opaque session in an HttpOnly cookie. No Supabase Auth, no passwords,
no email.

## Phone identity

- Business identity: normalized E.164 phone (`+994501234567`),
  produced by `libphonenumber-js` with region AZ (`src/auth/phone.ts`).
  National formats ("050 123 45 67") normalize; anything invalid gets
  a generic `AUTH_INVALID_PHONE`.
- Relationships always use `users.id` UUID. The API exposes only a
  masked phone (`+994•••••••67`).

## OTP lifecycle

```
request → PENDING ──verify ok──────────→ VERIFIED (one-time, consumed)
             │ ├─ max failed attempts ──→ LOCKED
             │ ├─ superseded / delivery-failed → EXPIRED
             │ └─ expires_at passes  (state may lag; correctness
             │                        always checks expires_at)
             └─ resend: rotates code_hash IN PLACE (same challenge,
                resend_count++, last_sent_at reset; old code dead;
                attempts stay cumulative)
```

Defaults (validated config, `src/auth/config.ts`): 6 digits, TTL 300s,
resend cooldown 45s, max 5 attempts, max 3 resends. A new request for
a phone supersedes its previous PENDING challenges — one live
challenge per phone.

## OTP hashing

`HMAC-SHA256(OTP_PEPPER, "otp:v1:<challenge_id>:<code>")`, hash-only
storage, constant-time comparison (`src/auth/otp-crypto.ts`). The
pepper lives only in the deployment environment, so a leaked database
cannot brute-force 20-bit codes offline; online guessing is capped by
the attempt counter. bcrypt/argon was deliberately not added: a keyed
HMAC already removes the offline-attack surface and adds no
per-verification latency. Pepper rotation invalidates live challenges
(5-minute artifacts) and IP windows only.

## Rate limiting (PostgreSQL-backed, no Redis)

From `otp_challenges` history alone: per-phone minimum interval (45s)
and hourly cap (5); per-IP hourly cap (10) via `ip_hash =
HMAC(pepper, "ip:v1:"+ip)` — raw IPs are never stored; per-challenge
attempt/resend caps. 429 responses carry safe retry seconds.
IP source: first `x-forwarded-for` entry — trustworthy on
Vercel/Cloudflare where the platform controls the header; self-hosted
deployments must strip client-supplied values at the edge; absent
header ⇒ IP limiting skipped (never trust fabrication).

## WhatsApp provider

`WhatsAppOtpProvider` interface (`src/providers/whatsapp/`), no
Meta/BSP SDK dependency. Delivery runs AFTER the DB transaction
commits; definitive failure expires the challenge (no usable
undeliverable challenges) and returns a generic 502. Timeout/unknown
provider states currently fail conservatively the same way — refine
when the real provider lands.
- Dev provider: logs the code with a masked phone; constructor throws
  in production.
- Test provider: in-memory capture, injected via a test-only seam.
- **Production checkpoint: no real provider exists yet** — production
  OTP sending fails loudly until the Meta/BSP integration is approved
  and implemented.

## User creation / login

Successful verification runs in ONE transaction with the challenge
row locked (`FOR UPDATE`): consume challenge → `INSERT … ON CONFLICT
(phone_e164) DO UPDATE` (find-or-create; sets last_login_at,
phone_verified_at) → USER role `ON CONFLICT DO NOTHING` → session
insert. Concurrent verifications serialize on the row lock: exactly
one consumes; duplicates are impossible (the UNIQUE phone constraint
is defense-in-depth). Failed attempts are committed via
return-not-throw so brute-force counting survives rollback. Responses
never distinguish new from existing users.

## Blocked users

BLOCKED users authenticate normally and see `status: "BLOCKED"` in
`/auth/me`. Future protected mutations (listings, payments,
promotions) must check `status` from the auth context — the
restriction lives at the mutation guards, not at login.

## Sessions

- Token: 32 random bytes (base64url); the cookie is its only home.
  DB stores unkeyed SHA-256 only (high-entropy token ⇒ keyed hash
  unnecessary). Never logged.
- Cookie `avtosh_session`: HttpOnly, SameSite=Lax, Path=/, Secure in
  production, Max-Age = 30 days; centralized in `src/auth/cookies.ts`.
  No user IDs/roles in cookies.
- Validity is enforced at query time — `revoked_at IS NULL AND
  expires_at > now()` — never by cleanup jobs.
- `last_seen_at` is throttled to one write per 5 minutes per session.
- Fixation defense: every verification issues a fresh session; a
  presented old session is revoked. Multiple concurrent sessions per
  user are allowed (future security UI may list/revoke them).
- Logout (POST, same-origin-guarded) revokes the session and clears
  the cookie idempotently.

## return_to & CSRF convention

- `sanitizeReturnTo` (`src/lib/security/return-to.ts`): internal
  paths only; rejects `//host`, backslashes, schemes, `://`, control
  chars/spaces, oversized values, and re-checks the percent-decoded
  form. Invalid values become null (ignored), never redirects.
- CSRF: SameSite=Lax is the base; `assertSameOrigin`
  (`src/lib/security/origin.ts`) additionally verifies the Origin
  header on state-changing authenticated requests. Convention for
  later phases: every session-authenticated mutation route calls
  `assertSameOrigin` first. OTP request/verify are unauthenticated
  and rate-limited instead.

## Cleanup (future jobs, not security)

Expired challenges/sessions are already inert. A later async job may
mark stale rows EXPIRED / delete very old rows for hygiene; retention
of challenge rows feeds the rate-limit windows, so keep at least the
last hour. Never security-critical.

## Secrets

`OTP_PEPPER` (required for OTP flows, ≥16 chars, no default) — see
`.env.example`. Tests/CI use a committed dummy pepper (not a secret).
Never logged: OTP codes (outside the guarded dev provider), hashes,
raw session tokens, full phones (masked only), provider credentials.

## Production integration checkpoints

1. Meta/BSP WhatsApp provider implementation + template approval.
2. Confirm the trusted IP header chain for the final Vercel/Cloudflare
   topology.
3. Decide session TTL/renewal policy before launch (currently fixed
   30 days, no sliding renewal).
