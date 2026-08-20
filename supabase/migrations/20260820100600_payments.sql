-- 006 — Payment domain: payments, payment_events.
--
-- Money representation: bigint minor units (200 = 2.00 AZN). Never
-- floating point. Prices are resolved server-side; fulfillment only
-- after verified provider confirmation (webhook), never on redirect.
--
-- This migration also closes the documented FK cycle from 004 by
-- adding the payment FKs to listing_periods and listing_publications.

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  listing_id uuid references listings (id) on delete restrict,
  type payment_type not null,
  amount_minor bigint not null
    constraint payments_amount_nonnegative check (amount_minor >= 0),
  currency char(3) not null default 'AZN'
    constraint payments_currency_shape check (currency ~ '^[A-Z]{3}$'),
  provider text not null,
  provider_order_id text,
  provider_transaction_id text unique,
  idempotency_key text not null unique,
  status payment_status not null default 'CREATED',
  fulfillment_status payment_fulfillment_status not null default 'PENDING',
  -- Snapshot of the purchased promotion package at purchase time
  -- (package rows are mutable; payments are history).
  package_duration_days integer
    constraint payments_package_duration_positive
      check (package_duration_days is null or package_duration_days > 0),
  package_price_minor bigint
    constraint payments_package_price_nonnegative
      check (package_price_minor is null or package_price_minor >= 0),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'
);
-- payments.promotion_package_id is added in migration 007, after
-- promotion_packages exists.

-- Provider webhook/event history — the webhook deduplication and
-- audit foundation. Uniqueness is scoped to (provider, event id)
-- because provider event IDs are only guaranteed unique per provider.
create table payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments (id) on delete restrict,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processing_status payment_event_processing_status not null default 'RECEIVED',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_events_provider_event_unique
    unique (provider, provider_event_id)
);

-- Close the 004 FK cycle: money/publication history must never
-- cascade away, hence RESTRICT.
alter table listing_periods
  add constraint listing_periods_payment_fk
  foreign key (payment_id) references payments (id) on delete restrict;

alter table listing_publications
  add constraint listing_publications_payment_fk
  foreign key (payment_id) references payments (id) on delete restrict;
