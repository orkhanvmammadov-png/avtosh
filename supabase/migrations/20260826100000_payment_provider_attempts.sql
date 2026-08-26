-- 017 — Kapital Bank checkout attempts (Phase 4.12, additive only).
--
-- One payment intent (the immutable LISTING_FEE snapshot) may need
-- several provider checkout attempts over its life (declined, expired
-- or abandoned hosted-payment sessions followed by a retry). Attempts
-- are append-only audit rows; the partial unique index enforces AT
-- MOST ONE non-terminal (active) attempt per payment at the database
-- level, which is the authoritative concurrency guard for double
-- clicked / simultaneous checkout creation.
--
-- hpp_secret is the provider's order password required to reopen the
-- hosted payment page. It is provider-sensitive: never exposed in any
-- DTO, never logged, and cleared as soon as the attempt reaches a
-- terminal state.

create table payment_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments (id) on delete restrict,
  provider text not null,
  provider_order_id text not null,
  hpp_url text not null,
  hpp_secret text,
  provider_status text not null default 'Preparing',
  verified_at timestamptz,
  is_terminal boolean not null default false,
  succeeded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_provider_attempts_order_unique
    unique (provider, provider_order_id),
  -- a successful attempt is by definition terminal
  constraint payment_provider_attempts_success_terminal
    check (not succeeded or is_terminal)
);

-- The concurrency guard: only one live checkout per payment intent.
create unique index payment_provider_attempts_one_active
  on payment_provider_attempts (payment_id)
  where not is_terminal;

create index payment_provider_attempts_payment
  on payment_provider_attempts (payment_id);

-- Reconciliation scan: pending Kapital payments needing verification.
create index payments_pending_provider
  on payments (provider, created_at)
  where status = 'PENDING';
