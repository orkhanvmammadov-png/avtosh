-- Guest image uploads (deferred-login PR B).
--
-- A pending upload belongs to EXACTLY ONE owner: a real user XOR a
-- guest draft session — the same XOR discipline as listings. Existing
-- rows keep their user_id untouched. Every guest lookup/mutation is
-- scoped to the cookie-derived, unexpired session AND its guest-owned
-- DRAFT listing; an upload id or listing id alone never authorizes.
--
-- PR C CLAIM CONTRACT (uploads): the claim transaction, after
-- re-homing the listings row (owner_id = user, guest_session_id =
-- NULL), MUST also re-home this listing's pending uploads:
--   update listing_image_uploads
--   set user_id = <user>, guest_session_id = null
--   where listing_id = <listing> and guest_session_id = <session>;
-- so (a) in-flight uploads stay confirmable through the authenticated
-- routes and (b) no upload row's session FK can block guest-session
-- cleanup. The cleanup sweep additionally refuses to delete a session
-- that still has upload rows (defense in depth, never the mechanism).

alter table listing_image_uploads
  alter column user_id drop not null;

alter table listing_image_uploads
  add column guest_session_id uuid
    references guest_draft_sessions (id) on delete restrict;

alter table listing_image_uploads
  add constraint listing_image_uploads_exactly_one_owner check (
    (user_id is not null and guest_session_id is null)
    or (user_id is null and guest_session_id is not null)
  );

-- Guest-scoped lookups and the per-session hourly issuance cap.
create index listing_image_uploads_guest_session_idx
  on listing_image_uploads (guest_session_id, created_at)
  where guest_session_id is not null;
