-- 014 — Pre-provider payment intents (Phase 4.6).
--
-- Gap: a paid initial listing publication must record an internal
-- LISTING_FEE payment intent BEFORE any payment provider/checkout
-- exists, but payments.provider was NOT NULL. Faking a provider value
-- is forbidden, so provider becomes nullable while still being
-- mandatory as soon as a payment progresses beyond the CREATED /
-- CANCELLED states (PENDING, SUCCESS, FAILED, REFUNDED always carry a
-- real provider). Additive, non-destructive.

alter table payments alter column provider drop not null;

alter table payments
  add constraint payments_provider_required_once_progressed
  check (provider is not null or status in ('CREATED', 'CANCELLED'));
