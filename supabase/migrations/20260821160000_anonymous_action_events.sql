-- 016 — Generic anonymous-action rate limiting (Phase 4.9).
--
-- Gap: anonymous contact reveal needs abuse windows, but the accepted
-- rate-limit persistence (otp_challenges history) only counts OTP
-- issuance. This small generic bucket supports any future anonymous
-- action (reports, reveals, ...) without duplicating architecture.
-- source_hash is ALWAYS a keyed HMAC of the canonical client IP
-- (never a raw IP); subject_id is the acted-on entity (text for
-- generality). Rows are short-lived window data — a future cleanup
-- job may prune them; correctness only ever counts recent rows.

create table anonymous_action_events (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  source_hash text not null,
  subject_id text,
  created_at timestamptz not null default now()
);

-- Window counting: recent events per action + source (subject filter
-- rides on the same index prefix).
create index anonymous_action_events_window
  on anonymous_action_events (action, source_hash, created_at desc);
