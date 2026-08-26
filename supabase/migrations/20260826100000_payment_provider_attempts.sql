-- 017 — Kapital Bank checkout attempts (Phase 4.12, additive only).
--
-- One payment intent (the immutable LISTING_FEE snapshot) may need
-- several provider checkout attempts over its life. Attempts are
-- append-only audit rows AND the checkout-initiation claim: a row is
-- inserted in the INITIATING state (provider_order_id IS NULL)
-- BEFORE the external POST /order, and the partial unique index
-- below guarantees AT MOST ONE non-terminal attempt per payment — so
-- for N concurrent checkout requests exactly one may perform the
-- provider side effect; the rest reuse or wait. The claim is durable:
-- a crash between claim and persistence leaves an INITIATING row
-- whose age (created_at) acts as the recovery lease.
--
-- hpp_secret is the provider's order password required to open the
-- hosted payment page. It is provider-sensitive: never exposed in any
-- DTO, never logged, and cleared as soon as the attempt reaches a
-- terminal state.

create table payment_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments (id) on delete restrict,
  provider text not null,
  -- NULL while the attempt is an initiation claim (no provider order yet)
  provider_order_id text,
  hpp_url text,
  hpp_secret text,
  provider_status text not null default 'Initiating',
  verified_at timestamptz,
  is_terminal boolean not null default false,
  succeeded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_provider_attempts_order_unique
    unique (provider, provider_order_id),
  -- a successful attempt is by definition terminal and order-backed
  constraint payment_provider_attempts_success_terminal
    check (not succeeded or is_terminal),
  constraint payment_provider_attempts_success_has_order
    check (not succeeded or provider_order_id is not null)
);

-- The concurrency/initiation guard: only one live attempt (claim or
-- active checkout) per payment intent.
create unique index payment_provider_attempts_one_active
  on payment_provider_attempts (payment_id)
  where not is_terminal;

create index payment_provider_attempts_payment
  on payment_provider_attempts (payment_id);

-- Reconciliation scan: pending Kapital payments needing verification.
create index payments_pending_provider
  on payments (provider, created_at)
  where status = 'PENDING';
