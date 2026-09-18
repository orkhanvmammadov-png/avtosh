-- O.12 Stage C: staged (edit-revision) uploads confirm into
-- listing_edit_images, so the upload row needs its own completion
-- reference — the existing image_id FK targets listing_images and must
-- keep doing exactly that for the draft pipeline. Additive only.
alter table listing_image_uploads
  add column edit_image_id uuid references listing_edit_images (id) on delete set null,
  add constraint listing_image_uploads_one_completion_target
    check (image_id is null or edit_image_id is null);

comment on column listing_image_uploads.edit_image_id is
  'Set exactly once when the upload confirms into a staged edit image; mutually exclusive with image_id.';
