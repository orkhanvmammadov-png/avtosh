-- 002 — Identity domain: users, roles, user_roles, otp_challenges,
-- sessions.
--
-- Business identity is the E.164 phone number (unique), but all
-- relationships use users.id UUID. The phone shape CHECK is a coarse
-- database guard; full normalization/validation is application code.

create table users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 varchar(16) not null unique
    constraint users_phone_e164_shape check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at timestamptz,
  display_name varchar(100),
  status user_status not null default 'ACTIVE',
  last_login_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_blocked_consistency
    check (status <> 'BLOCKED' or blocked_at is not null)
);

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();

-- Normalized roles (USER / MODERATOR / ADMIN / SUPER_ADMIN seeded in
-- the seed migration). Granular capability tables may come later.
create table roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table user_roles (
  user_id uuid not null references users (id) on delete cascade,
  role_id uuid not null references roles (id) on delete restrict,
  granted_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

-- OTP challenges. Only the hash of the code is ever stored.
create table otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 varchar(16) not null
    constraint otp_challenges_phone_e164_shape
      check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text not null default 'LOGIN',
  code_hash text not null,
  status otp_status not null default 'PENDING',
  expires_at timestamptz not null,
  attempt_count integer not null default 0
    constraint otp_challenges_attempt_count_nonnegative check (attempt_count >= 0),
  max_attempts integer not null default 5
    constraint otp_challenges_max_attempts_positive check (max_attempts > 0),
  resend_count integer not null default 0
    constraint otp_challenges_resend_count_nonnegative check (resend_count >= 0),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- Opaque sessions: only the token hash is stored, never the raw token.
-- A user may hold multiple active sessions. Sessions are genuinely
-- owned children — deleting a user removes their sessions.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
