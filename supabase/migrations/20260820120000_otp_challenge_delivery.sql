-- 012 — OTP challenge delivery tracking & privacy-preserving IP
-- rate limiting (Phase 4.4).
--
-- Gap in the accepted otp_challenges schema, both additive:
-- * Resend rotates the OTP inside the existing challenge, so the
--   resend cooldown needs the time of the LAST send — created_at only
--   records the first one.
-- * IP-level abuse protection needs a privacy-preserving IP key.
--   ip_hash stores HMAC-SHA256(server pepper, canonical IP) — never a
--   raw IP address. NULL when no trustworthy client IP is available.

alter table otp_challenges
  add column last_sent_at timestamptz not null default now(),
  add column ip_hash text;

-- IP-window rate limiting: count recent challenges per hashed IP.
create index otp_challenges_ip_recent
  on otp_challenges (ip_hash, created_at desc)
  where ip_hash is not null;
