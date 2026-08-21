# Moderator API Contract (v1)

Staff-only (`MODERATOR`, `ADMIN`, `SUPER_ADMIN`; `STAFF_ROLE_REQUIRED`
403 otherwise, `USER_BLOCKED` 403 for blocked accounts). Standard
envelope, request-ID echo, same-origin guard on all POSTs. Design in
`../architecture/moderation.md`.

| Route | Body | Result |
| --- | --- | --- |
| `GET /moderator/listings?limit=20&cursor=` | — | `{ items: QueueItem[], next_cursor }` oldest-first PENDING_MODERATION |
| `GET /moderator/listings/:id` | — | full review view incl. images (signed URLs), reviews, claim |
| `POST /moderator/listings/:id/claim` | — | `{ claim: { moderatorId, expiresAt } }` |
| `POST /moderator/listings/:id/approve` | `{ expected_revision }` | decision result with `activation { publishedAt, currentExpiresAt, periodNumber }` |
| `POST /moderator/listings/:id/reject` | `{ expected_revision, reason_code, note? }` | decision result, `activation: null` |
| `POST /moderator/listings/:id/request-correction` | `{ expected_revision, reason_code, note? }` | decision result, `activation: null` |

QueueItem: `{ id, publicId, category, brandName, modelName, year,
priceMinor, cityName, submittedAt, revision, seller { id, phoneMasked,
displayName }, primaryImageUrl, claim }`.

Reason codes: `INVALID_PHOTOS, MISLEADING_INFO, WRONG_CATEGORY,
DUPLICATE_LISTING, PROHIBITED_ITEM, INCOMPLETE_INFO, SUSPICIOUS_PRICE,
CONTACT_ISSUE, OTHER`; `note` ≤ 1000 chars plain text.

Errors: `MODERATION_INVALID_STATE` 409 (not pending / already decided
differently) · `MODERATION_CLAIM_REQUIRED` 409 ·
`MODERATION_CLAIMED_BY_OTHER` 409 · `LISTING_REVISION_CONFLICT` 409 ·
`LISTING_CONFIGURATION_ERROR` 500 (validity setting missing) ·
`LISTING_NOT_FOUND` 404 · `VALIDATION_ERROR` 400.

Idempotency: repeating an identical decision returns the existing
result; no duplicate reviews, periods, history, or outbox events.
