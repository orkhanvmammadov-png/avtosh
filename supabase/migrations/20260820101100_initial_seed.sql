-- 011 — Initial stable system/reference seed data.
--
-- Seeded: roles, categories, reference groups + stable option codes,
-- documented system setting defaults. Deliberately NOT seeded:
-- brand/model catalog (Phase 4.3), cities, Boost/Premium package
-- prices (not finalized), users/admin accounts, notification rows.

-- --- roles -------------------------------------------------------------------
insert into roles (code, description) values
  ('USER', 'Regular marketplace user'),
  ('MODERATOR', 'Reviews listings and reports'),
  ('ADMIN', 'Administers users, settings and moderation'),
  ('SUPER_ADMIN', 'Full administrative control');

-- --- categories --------------------------------------------------------------
insert into categories (code, name_az, slug, sort_order) values
  ('CAR', 'Avtomobillər', 'avtomobiller', 1),
  ('MOTORCYCLE', 'Motosikletlər', 'motosikletler', 2);

-- --- reference groups --------------------------------------------------------
insert into reference_groups (code, description) values
  ('FUEL_TYPE', 'Engine fuel type'),
  ('TRANSMISSION', 'Gearbox type'),
  ('BODY_TYPE', 'Car body type'),
  ('DRIVE_TYPE', 'Drivetrain'),
  ('MOTORCYCLE_TYPE', 'Motorcycle type'),
  ('COLOR', 'Vehicle color');

-- --- reference options -------------------------------------------------------
insert into reference_options (group_code, code, name_az, sort_order) values
  ('FUEL_TYPE', 'PETROL', 'Benzin', 1),
  ('FUEL_TYPE', 'DIESEL', 'Dizel', 2),
  ('FUEL_TYPE', 'GAS', 'Qaz', 3),
  ('FUEL_TYPE', 'HYBRID', 'Hibrid', 4),
  ('FUEL_TYPE', 'ELECTRIC', 'Elektrik', 5),
  ('TRANSMISSION', 'MANUAL', 'Mexaniki', 1),
  ('TRANSMISSION', 'AUTOMATIC', 'Avtomat', 2),
  ('TRANSMISSION', 'ROBOT', 'Robotlaşdırılmış', 3),
  ('TRANSMISSION', 'CVT', 'Variator', 4),
  ('DRIVE_TYPE', 'FWD', 'Ön', 1),
  ('DRIVE_TYPE', 'RWD', 'Arxa', 2),
  ('DRIVE_TYPE', 'AWD', 'Tam', 3),
  ('COLOR', 'WHITE', 'Ağ', 1),
  ('COLOR', 'BLACK', 'Qara', 2),
  ('COLOR', 'SILVER', 'Gümüşü', 3),
  ('COLOR', 'GRAY', 'Boz', 4),
  ('COLOR', 'RED', 'Qırmızı', 5),
  ('COLOR', 'BLUE', 'Göy', 6),
  ('COLOR', 'GREEN', 'Yaşıl', 7),
  ('COLOR', 'YELLOW', 'Sarı', 8),
  ('COLOR', 'BROWN', 'Qəhvəyi', 9),
  ('COLOR', 'BEIGE', 'Bej', 10),
  ('COLOR', 'ORANGE', 'Narıncı', 11),
  ('COLOR', 'PURPLE', 'Bənövşəyi', 12);

-- Category-scoped groups.
insert into reference_options (group_code, code, name_az, category_id, sort_order) values
  ('BODY_TYPE', 'SEDAN', 'Sedan', (select id from categories where code = 'CAR'), 1),
  ('BODY_TYPE', 'SUV', 'Offroader / SUV', (select id from categories where code = 'CAR'), 2),
  ('BODY_TYPE', 'HATCHBACK', 'Hetçbek', (select id from categories where code = 'CAR'), 3),
  ('BODY_TYPE', 'UNIVERSAL', 'Universal', (select id from categories where code = 'CAR'), 4),
  ('BODY_TYPE', 'COUPE', 'Kupe', (select id from categories where code = 'CAR'), 5),
  ('BODY_TYPE', 'MINIVAN', 'Minivan', (select id from categories where code = 'CAR'), 6),
  ('BODY_TYPE', 'PICKUP', 'Pikap', (select id from categories where code = 'CAR'), 7),
  ('BODY_TYPE', 'LIFTBACK', 'Liftbek', (select id from categories where code = 'CAR'), 8),
  ('MOTORCYCLE_TYPE', 'SPORT', 'Sport', (select id from categories where code = 'MOTORCYCLE'), 1),
  ('MOTORCYCLE_TYPE', 'CRUISER', 'Kruizer', (select id from categories where code = 'MOTORCYCLE'), 2),
  ('MOTORCYCLE_TYPE', 'TOURING', 'Turinq', (select id from categories where code = 'MOTORCYCLE'), 3),
  ('MOTORCYCLE_TYPE', 'NAKED', 'Klassik / Naked', (select id from categories where code = 'MOTORCYCLE'), 4),
  ('MOTORCYCLE_TYPE', 'ENDURO', 'Enduro', (select id from categories where code = 'MOTORCYCLE'), 5),
  ('MOTORCYCLE_TYPE', 'SCOOTER', 'Skuter', (select id from categories where code = 'MOTORCYCLE'), 6),
  ('MOTORCYCLE_TYPE', 'MOPED', 'Moped', (select id from categories where code = 'MOTORCYCLE'), 7);

-- --- system settings ---------------------------------------------------------
-- Documented stable business defaults (CLAUDE.md). Monetary values
-- use minor units (200 = 2.00 AZN), consistent with the payment core.
-- Boost/Premium package prices are NOT seeded (not finalized).
insert into system_settings (key, value, value_type, description) values
  ('listing.validity_days', '30', 'integer', 'Approved listing validity in days'),
  ('listing.free_publication_limit', '3', 'integer',
   'Lifetime number of free NEW listing publications per user (accounting source of truth is listing_publications, not this value alone)'),
  ('listing.publication_fee_minor', '200', 'money_minor',
   'Fee for publication #4+ in AZN minor units (200 = 2.00 AZN)'),
  ('listing.renewal_fee_minor', '200', 'money_minor',
   'Renewal fee for an expired listing in AZN minor units'),
  ('listing.renewal_duration_days', '30', 'integer', 'Renewal validity in days'),
  ('listing.image_min', '3', 'integer', 'Recommended minimum images per listing'),
  ('listing.image_max', '20', 'integer', 'Maximum images per listing'),
  ('boost.first_view_slots_desktop', '4', 'integer', 'Boost slots in first search view (desktop)'),
  ('boost.first_view_slots_tablet', '3', 'integer', 'Boost slots in first search view (tablet)'),
  ('boost.first_view_slots_mobile', '2', 'integer', 'Boost slots in first search view (mobile)'),
  ('notification.expiry_reminder_days', '[7, 5, 3, 1]', 'integer_array',
   'Days before listing expiry to send WhatsApp reminders'),
  ('notification.send_hour_baku', '10', 'integer',
   'Suggested local send hour (Asia/Baku) for scheduled reminders');
