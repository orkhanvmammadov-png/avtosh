-- 009 — Governance domain: system_settings, audit_logs, outbox_events.

-- Controlled key/value settings. This table is NOT permission for
-- application code to accept arbitrary settings — service code will
-- validate against an allowlist. Monetary values use minor units,
-- consistent with the payment core.
create table system_settings (
  key text primary key,
  value jsonb not null,
  value_type text not null
    constraint system_settings_value_type_allowed
      check (value_type in ('string', 'integer', 'boolean', 'money_minor', 'integer_array', 'json')),
  description text,
  updated_by uuid references users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger system_settings_set_updated_at
  before update on system_settings
  for each row execute function set_updated_at();

-- Append-only audit log. The application must never UPDATE or DELETE
-- audit rows (CLAUDE.md). Enforced in-database by a trigger below —
-- portable and independent of Supabase role provisioning, which is
-- not configured in this phase. When Supabase roles are provisioned,
-- additionally REVOKE UPDATE, DELETE ON audit_logs from the runtime
-- role. entity_id is text so any entity key type can be recorded.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users (id) on delete set null,
  actor_type actor_type not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create function prevent_audit_log_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only: % is not allowed', tg_op
    using errcode = 'raise_exception';
end;
$$;

create trigger audit_logs_append_only
  before update or delete on audit_logs
  for each row execute function prevent_audit_log_mutation();

-- Durable outbox for asynchronous events (LISTING_ACTIVATED,
-- PAYMENT_SUCCEEDED, LISTING_SOLD, ...). Processing code is a later
-- phase; all jobs consuming it must be idempotent.
create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  status outbox_status not null default 'PENDING',
  attempt_count integer not null default 0
    constraint outbox_events_attempt_count_nonnegative check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
