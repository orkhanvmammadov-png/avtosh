-- 010 — Query-driven indexes. Every index here has an expected access
-- pattern; unique/exclusion constraints already live with their
-- tables. Public listing queries always filter
-- status = 'ACTIVE' AND current_expires_at > now(), which is why the
-- search indexes are partial on ACTIVE.

-- --- listings: public search -----------------------------------------------
-- Primary browse/search path: category (+ brand/model when selected),
-- newest first.
create index listings_active_search
  on listings (category_id, brand_id, model_id, published_at desc)
  where status = 'ACTIVE';

-- Filter/sort dimensions inside ACTIVE results.
create index listings_active_price
  on listings (price_minor) where status = 'ACTIVE';
create index listings_active_year
  on listings (year) where status = 'ACTIVE';
create index listings_active_mileage
  on listings (mileage) where status = 'ACTIVE';
create index listings_active_city
  on listings (city_id) where status = 'ACTIVE';

-- Expiry job: find ACTIVE listings whose period ended.
create index listings_active_expires_at
  on listings (current_expires_at) where status = 'ACTIVE';

-- Moderator queue: pending listings ordered by submission time.
create index listings_moderation_queue
  on listings (submitted_at) where status = 'PENDING_MODERATION';

-- Owner dashboard ("my listings").
create index listings_owner on listings (owner_id, created_at desc);

-- --- identity ----------------------------------------------------------------
-- OTP phone-level rate limiting: recent challenges per phone.
create index otp_challenges_phone_recent
  on otp_challenges (phone_e164, created_at desc);

-- Session lookup by user and stale-session cleanup job.
create index sessions_user on sessions (user_id);
create index sessions_expires_at on sessions (expires_at);

-- Role membership lookups by role (moderator lists etc.).
create index user_roles_role on user_roles (role_id);

-- --- catalog -----------------------------------------------------------------
-- Model pickers: models of a brand within a category.
create index models_brand_category on models (brand_id, category_id, sort_order);

-- Reference dropdowns per group.
create index reference_options_group
  on reference_options (group_code, sort_order);

-- --- marketplace children ----------------------------------------------------
create index listing_images_listing on listing_images (listing_id, sort_order);
create index listing_periods_listing on listing_periods (listing_id);
create index favorites_listing on favorites (listing_id);
create index listing_publications_user on listing_publications (user_id);

-- --- moderation --------------------------------------------------------------
create index moderation_reviews_listing
  on moderation_reviews (listing_id, created_at desc);
create index listing_status_history_listing
  on listing_status_history (listing_id, created_at desc);
create index listing_reports_status
  on listing_reports (status, created_at);
create index listing_reports_listing on listing_reports (listing_id);

-- --- payments ----------------------------------------------------------------
-- User payment history; reconciliation of stale/pending payments.
create index payments_user on payments (user_id, created_at desc);
create index payments_status on payments (status, created_at);
create index payments_listing on payments (listing_id);
create index payment_events_payment on payment_events (payment_id);

-- --- promotions --------------------------------------------------------------
-- Promotion expiry job and Home/search feed lookups.
create index listing_promotions_type_status_ends
  on listing_promotions (type, status, ends_at);
create index listing_promotions_listing on listing_promotions (listing_id);

-- --- notifications -----------------------------------------------------------
-- Sender job: due SCHEDULED notifications.
create index notifications_due
  on notifications (scheduled_for) where status = 'SCHEDULED';
create index notifications_user on notifications (user_id, created_at desc);
create index notifications_listing_period on notifications (listing_period_id);

-- --- governance --------------------------------------------------------------
-- Audit lookups per entity and per actor.
create index audit_logs_entity
  on audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor on audit_logs (actor_user_id, created_at desc);

-- Outbox worker: due PENDING events.
create index outbox_events_due
  on outbox_events (available_at) where status = 'PENDING';
