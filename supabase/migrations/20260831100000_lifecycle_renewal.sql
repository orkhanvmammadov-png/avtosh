-- 019 — Lifecycle jobs & renewal foundation (Phase 4.16, additive only).
--
-- 1) Renewal purchase-intent idempotency: at most ONE open (CREATED
--    or PENDING) RENEWAL payment per listing — the same structural
--    guarantee promotions received in migration 018. Double clicks and
--    concurrent renewal requests converge on the single open intent;
--    a new renewal becomes possible the moment the previous one is
--    terminal.
create unique index payments_open_renewal_intent
  on payments (listing_id)
  where status in ('CREATED', 'PENDING') and type = 'RENEWAL';

-- 2) Renewal duration snapshot. Renewal fee/duration come from
--    system_settings, which admins may change at any time; payments
--    are history, so the granted duration must be immutable on the
--    payment row (package_duration_days is the PROMOTION package
--    snapshot and keeps its meaning).
alter table payments
  add column renewal_duration_days integer
    constraint payments_renewal_duration_positive
      check (renewal_duration_days is null or renewal_duration_days > 0);

-- 3) Report intake (buyer-side MVP): constrain reason codes to the
--    controlled server set. reason_code was free text; every accepted
--    writer (tests/fixtures) already uses FRAUD_SUSPECTED, which is in
--    the set. The API layer enforces the same enum — this is defense
--    in depth at the storage boundary.
alter table listing_reports
  add constraint listing_reports_reason_allowed
    check (reason_code in (
      'WRONG_INFORMATION',
      'DUPLICATE',
      'FRAUD_SUSPECTED',
      'SOLD_OR_UNAVAILABLE',
      'PROHIBITED_CONTENT',
      'OTHER'
    ));

-- 4) Register the expiry-reminder template identity (versioned model
--    from migration 008). DRAFT + inactive: WhatsApp Business template
--    approval is a LAUNCH CHECKPOINT — nothing may claim an approved
--    template exists. notifications rows reference the code; dev/test
--    providers render the body locally.
insert into notification_templates
  (code, channel, provider_template_name, language_code, version, status, is_active, body_preview)
values
  ('LISTING_EXPIRY_REMINDER', 'WHATSAPP', null, 'az', 1, 'DRAFT', false,
   'AVTOSH.AZ: "{{listing}}" elanınızın müddəti {{days}} gün sonra ({{date}}) bitir. Yeniləmək üçün: {{url}}');
