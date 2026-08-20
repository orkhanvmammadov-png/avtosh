-- Negative constraint tests for the AVTOSH.AZ schema.
-- Runs inside one transaction and rolls back — leaves the database
-- exactly as the migrations created it. Each case asserts that an
-- invalid write is REJECTED by the database; a case that unexpectedly
-- succeeds raises and aborts the whole script.

begin;

do $$
declare
  v_user1 uuid;
  v_user2 uuid;
  v_cat_car uuid;
  v_brand uuid;
  v_model uuid;
  v_city uuid;
  v_listing1 uuid;
  v_listing2 uuid;
  v_payment uuid;
  v_role_user uuid;
  v_period uuid;
begin
  -- ------------------------------------------------------------------ fixtures
  insert into users (phone_e164) values ('+994501234567') returning id into v_user1;
  insert into users (phone_e164) values ('+994551234567') returning id into v_user2;
  select id into v_cat_car from categories where code = 'CAR';
  insert into brands (name, slug) values ('TestBrand', 'testbrand') returning id into v_brand;
  insert into brand_categories (brand_id, category_id) values (v_brand, v_cat_car);
  insert into models (brand_id, category_id, name, slug)
    values (v_brand, v_cat_car, 'TestModel', 'testmodel') returning id into v_model;
  insert into cities (name_az, slug) values ('Bakı', 'baki') returning id into v_city;
  insert into listings (owner_id, category_id, brand_id, model_id, city_id)
    values (v_user1, v_cat_car, v_brand, v_model, v_city) returning id into v_listing1;
  insert into listings (owner_id, category_id, brand_id, model_id, city_id)
    values (v_user1, v_cat_car, v_brand, v_model, v_city) returning id into v_listing2;
  insert into payments (user_id, listing_id, type, amount_minor, provider, idempotency_key)
    values (v_user1, v_listing1, 'LISTING_FEE', 200, 'testpay', 'idem-1')
    returning id into v_payment;
  select id into v_role_user from roles where code = 'USER';
  insert into listing_periods (listing_id, period_number, source, starts_at, ends_at)
    values (v_listing1, 1, 'INITIAL', now(), now() + interval '30 days')
    returning id into v_period;

  -- ---------------------------------------------------------------- test cases

  -- 1. duplicate phone rejected
  begin
    insert into users (phone_e164) values ('+994501234567');
    raise exception 'TEST 1 FAILED: duplicate phone accepted';
  exception when unique_violation then raise notice 'ok 01: duplicate phone rejected';
  end;

  -- 2. malformed phone rejected
  begin
    insert into users (phone_e164) values ('0501234567');
    raise exception 'TEST 2 FAILED: malformed phone accepted';
  exception when check_violation then raise notice 'ok 02: malformed phone rejected';
  end;

  -- 3. duplicate user_role rejected
  begin
    insert into user_roles (user_id, role_id) values (v_user1, v_role_user);
    insert into user_roles (user_id, role_id) values (v_user1, v_role_user);
    raise exception 'TEST 3 FAILED: duplicate role assignment accepted';
  exception when unique_violation then raise notice 'ok 03: duplicate user_role rejected';
  end;

  -- 4. duplicate favorite rejected
  begin
    insert into favorites (user_id, listing_id) values (v_user2, v_listing1);
    insert into favorites (user_id, listing_id) values (v_user2, v_listing1);
    raise exception 'TEST 4 FAILED: duplicate favorite accepted';
  exception when unique_violation then raise notice 'ok 04: duplicate favorite rejected';
  end;

  -- 5. two primary images for one listing rejected
  begin
    insert into listing_images (listing_id, storage_path, is_primary, mime_type, file_size_bytes)
      values (v_listing1, 'a.webp', true, 'image/webp', 1000);
    insert into listing_images (listing_id, storage_path, is_primary, mime_type, file_size_bytes)
      values (v_listing1, 'b.webp', true, 'image/webp', 1000);
    raise exception 'TEST 5 FAILED: second primary image accepted';
  exception when unique_violation then raise notice 'ok 05: second primary image rejected';
  end;

  -- 6. invalid listing period (ends_at <= starts_at) rejected
  begin
    insert into listing_periods (listing_id, period_number, source, starts_at, ends_at)
      values (v_listing2, 1, 'INITIAL', now(), now());
    raise exception 'TEST 6 FAILED: zero-length period accepted';
  exception when check_violation then raise notice 'ok 06: invalid listing period rejected';
  end;

  -- 7. duplicate period_number within a listing rejected
  begin
    insert into listing_periods (listing_id, period_number, source, starts_at, ends_at)
      values (v_listing1, 1, 'RENEWAL', now(), now() + interval '30 days');
    raise exception 'TEST 7 FAILED: duplicate period_number accepted';
  exception when unique_violation then raise notice 'ok 07: duplicate period_number rejected';
  end;

  -- 8. duplicate provider event rejected
  begin
    insert into payment_events (payment_id, provider, provider_event_id, event_type, payload)
      values (v_payment, 'testpay', 'evt-1', 'payment.success', '{}');
    insert into payment_events (payment_id, provider, provider_event_id, event_type, payload)
      values (v_payment, 'testpay', 'evt-1', 'payment.success', '{}');
    raise exception 'TEST 8 FAILED: duplicate provider event accepted';
  exception when unique_violation then raise notice 'ok 08: duplicate provider event rejected';
  end;

  -- 9. duplicate notification dedupe_key rejected
  begin
    insert into notifications (user_id, type, template_code, scheduled_for, dedupe_key)
      values (v_user1, 'LISTING_EXPIRY_REMINDER', 'expiry_reminder', now(), 'dedupe-1');
    insert into notifications (user_id, type, template_code, scheduled_for, dedupe_key)
      values (v_user1, 'LISTING_EXPIRY_REMINDER', 'expiry_reminder', now(), 'dedupe-1');
    raise exception 'TEST 9 FAILED: duplicate dedupe_key accepted';
  exception when unique_violation then raise notice 'ok 09: duplicate dedupe_key rejected';
  end;

  -- 10. negative payment amount rejected
  begin
    insert into payments (user_id, type, amount_minor, provider, idempotency_key)
      values (v_user1, 'LISTING_FEE', -1, 'testpay', 'idem-neg');
    raise exception 'TEST 10 FAILED: negative amount accepted';
  exception when check_violation then raise notice 'ok 10: negative payment amount rejected';
  end;

  -- 11. duplicate initial publication per listing rejected
  begin
    insert into listing_publications (listing_id, user_id, publication_number, billing_type)
      values (v_listing1, v_user1, 1, 'FREE');
    insert into listing_publications (listing_id, user_id, publication_number, billing_type)
      values (v_listing1, v_user1, 2, 'FREE');
    raise exception 'TEST 11 FAILED: second initial publication accepted';
  exception when unique_violation then raise notice 'ok 11: duplicate initial publication rejected';
  end;

  -- 12. duplicate publication ordinal per user rejected (race guard)
  begin
    insert into listing_publications (listing_id, user_id, publication_number, billing_type)
      values (v_listing1, v_user1, 1, 'FREE');
    insert into listing_publications (listing_id, user_id, publication_number, billing_type)
      values (v_listing2, v_user1, 1, 'FREE');
    raise exception 'TEST 12 FAILED: duplicate publication_number accepted';
  exception when unique_violation then raise notice 'ok 12: duplicate publication ordinal rejected';
  end;

  -- 13. PAID publication without payment rejected
  begin
    insert into listing_publications (listing_id, user_id, publication_number, billing_type)
      values (v_listing2, v_user1, 7, 'PAID');
    raise exception 'TEST 13 FAILED: PAID publication without payment accepted';
  exception when check_violation then raise notice 'ok 13: PAID publication without payment rejected';
  end;

  -- 14. overlapping same-type promotion rejected
  begin
    insert into listing_promotions
      (listing_id, type, payment_id, starts_at, ends_at, status,
       purchased_duration_days, purchased_price_minor)
      values (v_listing1, 'BOOST', v_payment, now(), now() + interval '7 days',
              'ACTIVE', 7, 500);
    insert into listing_promotions
      (listing_id, type, payment_id, starts_at, ends_at, status,
       purchased_duration_days, purchased_price_minor)
      values (v_listing1, 'BOOST', v_payment, now() + interval '3 days',
              now() + interval '10 days', 'SCHEDULED', 7, 500);
    raise exception 'TEST 14 FAILED: overlapping same-type promotion accepted';
  exception when exclusion_violation then
    raise notice 'ok 14: overlapping same-type promotion rejected';
  end;

  -- 14b. PREMIUM alongside BOOST on the same listing is allowed
  insert into listing_promotions
    (listing_id, type, payment_id, starts_at, ends_at, status,
     purchased_duration_days, purchased_price_minor)
    values (v_listing1, 'BOOST', v_payment, now(), now() + interval '7 days',
            'ACTIVE', 7, 500);
  insert into listing_promotions
    (listing_id, type, payment_id, starts_at, ends_at, status,
     purchased_duration_days, purchased_price_minor)
    values (v_listing1, 'PREMIUM', v_payment, now(), now() + interval '7 days',
            'ACTIVE', 7, 900);
  raise notice 'ok 14b: PREMIUM + BOOST simultaneously allowed';

  -- 15. audit log UPDATE rejected (append-only)
  begin
    insert into audit_logs (actor_type, action, entity_type, entity_id)
      values ('SYSTEM', 'TEST', 'listing', v_listing1::text);
    update audit_logs set action = 'TAMPERED' where entity_id = v_listing1::text;
    raise exception 'TEST 15 FAILED: audit log update accepted';
  exception when raise_exception then raise notice 'ok 15: audit log update rejected';
  end;

  -- 16. audit log DELETE rejected (append-only)
  begin
    insert into audit_logs (actor_type, action, entity_type, entity_id)
      values ('SYSTEM', 'TEST2', 'listing', v_listing2::text);
    delete from audit_logs where entity_id = v_listing2::text;
    raise exception 'TEST 16 FAILED: audit log delete accepted';
  exception when raise_exception then raise notice 'ok 16: audit log delete rejected';
  end;

  -- 17. implausible listing year rejected
  begin
    update listings set year = 1800 where id = v_listing1;
    raise exception 'TEST 17 FAILED: year 1800 accepted';
  exception when check_violation then raise notice 'ok 17: implausible year rejected';
  end;

  -- 18. non-positive price rejected
  begin
    update listings set price_minor = 0 where id = v_listing1;
    raise exception 'TEST 18 FAILED: zero price accepted';
  exception when check_violation then raise notice 'ok 18: zero price rejected';
  end;

  -- 19. second active moderation claim rejected
  begin
    insert into moderation_claims (listing_id, moderator_id, expires_at)
      values (v_listing1, v_user2, now() + interval '30 minutes');
    insert into moderation_claims (listing_id, moderator_id, expires_at)
      values (v_listing1, v_user1, now() + interval '30 minutes');
    raise exception 'TEST 19 FAILED: second active claim accepted';
  exception when unique_violation then raise notice 'ok 19: second active claim rejected';
  end;

  -- 20. duplicate model name (case-insensitive) per brand/category rejected
  begin
    insert into models (brand_id, category_id, name, slug)
      values (v_brand, v_cat_car, 'TESTMODEL', 'testmodel-2');
    raise exception 'TEST 20 FAILED: duplicate model name accepted';
  exception when unique_violation then raise notice 'ok 20: duplicate model name rejected';
  end;

  -- 21. duplicate payment idempotency key rejected
  begin
    insert into payments (user_id, type, amount_minor, provider, idempotency_key)
      values (v_user1, 'RENEWAL', 200, 'testpay', 'idem-1');
    raise exception 'TEST 21 FAILED: duplicate idempotency_key accepted';
  exception when unique_violation then raise notice 'ok 21: duplicate idempotency key rejected';
  end;

  -- 22. non-positive declared upload size rejected (Phase 4.5 table)
  begin
    insert into listing_image_uploads
      (listing_id, user_id, temp_storage_path, declared_mime_type,
       declared_size_bytes, expires_at)
      values (v_listing1, v_user1, 'uploads/x', 'image/jpeg', 0,
              now() + interval '5 minutes');
    raise exception 'TEST 22 FAILED: zero declared upload size accepted';
  exception when check_violation then
    raise notice 'ok 22: non-positive declared upload size rejected';
  end;

  raise notice 'All constraint tests passed.';
end;
$$;

rollback;
