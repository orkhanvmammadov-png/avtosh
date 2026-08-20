-- 001 — Extensions, enum types, shared trigger functions.
--
-- gen_random_uuid() is built into PostgreSQL 13+, so no uuid extension
-- is required. btree_gist is needed for the listing_promotions
-- exclusion constraint (same-type promotion periods must not overlap
-- on one listing — CLAUDE.md: a repurchase queues after existing
-- active/scheduled time).

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Enum types. Only stable, tightly controlled lifecycles are enums;
-- manageable reference data (fuel types, colors, ...) lives in
-- reference_options and roles live in the roles table.
-- ---------------------------------------------------------------------------

create type user_status as enum ('ACTIVE', 'BLOCKED');

create type otp_status as enum ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED');

create type listing_status as enum (
  'DRAFT',
  'PAYMENT_REQUIRED',
  'PAYMENT_COMPLETED',
  'PENDING_MODERATION',
  'CORRECTION_REQUIRED',
  'REJECTED',
  'ACTIVE',
  'SUSPENDED',
  'SOLD',
  'EXPIRED',
  'DELETED'
);

create type billing_type as enum ('FREE', 'PAID');

create type listing_period_source as enum ('INITIAL', 'RENEWAL');

create type listing_period_status as enum ('ACTIVE', 'EXPIRED', 'CANCELLED');

create type moderation_decision as enum (
  'APPROVED',
  'REJECTED',
  'CORRECTION_REQUESTED'
);

create type report_status as enum ('OPEN', 'RESOLVED', 'DISMISSED');

create type payment_type as enum ('LISTING_FEE', 'RENEWAL', 'BOOST', 'PREMIUM');

create type payment_status as enum (
  'CREATED',
  'PENDING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'REFUNDED'
);

create type payment_fulfillment_status as enum ('PENDING', 'FULFILLED', 'FAILED');

create type payment_event_processing_status as enum (
  'RECEIVED',
  'PROCESSED',
  'FAILED',
  'IGNORED'
);

create type promotion_type as enum ('PREMIUM', 'BOOST');

create type promotion_status as enum ('SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED');

create type notification_channel as enum ('WHATSAPP');

create type notification_status as enum (
  'SCHEDULED',
  'PROCESSING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'CANCELLED'
);

create type notification_template_status as enum (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED'
);

create type actor_type as enum ('USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN', 'SYSTEM');

create type outbox_status as enum ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger. Single documented function; each table
-- with an updated_at column attaches one BEFORE UPDATE trigger to it.
-- ---------------------------------------------------------------------------

create function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
