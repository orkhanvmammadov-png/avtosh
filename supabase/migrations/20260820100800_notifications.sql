-- 008 — Notification domain: notification_templates, notifications.
--
-- WhatsApp expiry reminders (7/5/3/1 days) are scheduled against
-- listing_period_id. Creation and sending must be idempotent — the
-- unique dedupe_key is the database foundation for that (e.g.
-- "LISTING_EXPIRY_REMINDER:<listing_period_id>:D7"). No reminder rows
-- are seeded; scheduling is future service/job code.

create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  channel notification_channel not null,
  provider_template_name text,
  provider_template_id text,
  language_code varchar(8) not null default 'az',
  version integer not null default 1
    constraint notification_templates_version_positive check (version > 0),
  status notification_template_status not null default 'DRAFT',
  is_active boolean not null default false,
  body_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Versioning: one row per (code, channel, language, version).
  constraint notification_templates_version_unique
    unique (code, channel, language_code, version)
);

create trigger notification_templates_set_updated_at
  before update on notification_templates
  for each row execute function set_updated_at();

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  listing_id uuid references listings (id) on delete set null,
  listing_period_id uuid references listing_periods (id) on delete set null,
  type text not null,
  channel notification_channel not null default 'WHATSAPP',
  template_code text not null,
  template_version integer,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  status notification_status not null default 'SCHEDULED',
  provider_message_id text,
  provider_error_code text,
  dedupe_key text not null unique,
  attempt_count integer not null default 0
    constraint notifications_attempt_count_nonnegative check (attempt_count >= 0),
  next_retry_at timestamptz,
  payload jsonb not null default '{}',
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger notifications_set_updated_at
  before update on notifications
  for each row execute function set_updated_at();
