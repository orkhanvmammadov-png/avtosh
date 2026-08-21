# Listing Drafts (Phase 4.5)

Date: 2026-08-20
Status: implemented (drafts + images only — no submission/publication)

Authenticated sellers create and progressively edit DRAFT listings.
Submission, free/paid publication, and moderation entry are Phase 4.6.

## Lifecycle in this phase

Only `DRAFT` exists behaviorally. Creation requires just a category
(the schema's only non-null seller field); everything else fills in
via autosave. Draft edits never touch `published_at`,
`current_expires_at`, publications, payments, or moderation — a DRAFT
stays a DRAFT. Any non-DRAFT listing answers mutations with
`LISTING_NOT_EDITABLE` (409); there is no generic status PATCH.

## Authorization

- Identity comes only from the session cookie (Phase 4.4); request
  bodies can never name a user.
- Every owner read/mutation is scoped `owner_id = session user` in
  SQL. Missing and foreign listings both answer `LISTING_NOT_FOUND`
  (404) — no resource-existence leak (IDOR-safe).
- `requireActiveSeller` guards every mutation: BLOCKED users can
  authenticate and read (`/auth/me`, GET own listing) but get
  `USER_BLOCKED` (403) on any seller mutation.
- All mutations enforce the Phase 4.4 same-origin (Origin header)
  convention.

## Autosave & optimistic concurrency

`PATCH /me/listings/:id` takes `expected_revision` plus any subset of
the strict allowlist (unknown properties are rejected, not stripped —
autosave clients must never silently lose data). The update is one
atomic statement:

```
UPDATE listings SET <allowlisted>, revision = revision + 1
WHERE id AND owner_id AND status='DRAFT' AND revision = expected
```

Zero rows → reload to answer precisely: stale → 409
`LISTING_REVISION_CONFLICT` (with `current_revision`), state change →
`LISTING_NOT_EDITABLE`. Nothing ever silently overwrites a newer
save. Image mutations (add/delete/reorder/primary) are seller-visible
draft changes and **also increment revision** (decision: yes), which
later protects submission/moderation against stale state.

## Catalog validation

Reuses the catalog repository (new point lookups, same parameterized
style): brand must be active in the listing's category; model must be
active in that brand *and* category; category-scoped reference
options (BODY_TYPE ⇢ CAR, MOTORCYCLE_TYPE ⇢ MOTORCYCLE) never cross
categories; global groups (FUEL_TYPE, TRANSMISSION, DRIVE_TYPE,
COLOR) work everywhere; cities and features must be active and
category-compatible. Violations → `LISTING_INVALID_CATALOG_SELECTION`.

**Deterministic dependent clearing** (documented + tested):
- category change clears `brand_id`, `model_id`, `body_type_id`,
  `motorcycle_type_id` and removes now-incompatible features
  (globals survive), unless the same request supplies valid new
  values;
- brand change clears `model_id` unless a valid model is supplied.

Features use transactional replacement of the `listing_features` set
(duplicates impossible via the composite PK).

## Money & contact phone

`price_minor` (bigint minor units) in and out — no floats, no
decimal parsing. Contact phone is optional, normalized through the
accepted E.164 utility; invalid input is rejected, and nothing is
auto-filled from the account phone (explicit seller choice only).

## DTO

Owner DTO exposes form fields + `revision` + ordered images with
short-lived signed read URLs. Not exposed: storage paths, internal
moderation/audit fields, raw rows.

Companion docs: `storage-images.md` (upload pipeline),
`../api/listings.md` (contract), `../runbooks/supabase-storage.md`
(bucket setup).
