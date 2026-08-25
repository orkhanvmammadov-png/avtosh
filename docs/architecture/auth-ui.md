# AVTOSH.AZ — Authentication UI & Favorites Foundation (Phase 4.10)

Date: 2026-08-25
Status: implemented

Buyer-facing authentication UI on the accepted Phase 4.4 APIs, plus
favorites as the first buyer-engagement feature. No auth or business
rules were changed — this phase consumes the existing contracts.

## Routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/giris` | public | Phone → WhatsApp OTP login/registration (single flow) |
| `/profil` | session required | Minimal buyer profile shell (masked phone, links, logout) |
| `/profil/secilmisler` | session required | Saved listings |
| `/elan-yerlesdir` | session required | Placeholder ("tezliklə") — the seller wizard is a later phase; exists so the header CTA and protected-intent flow are real |

Protected pages call `getCurrentAuthFromCookies()` (server-side cookie
session lookup in `src/auth/current-user.ts`) and
`redirect("/giris?return_to=<path>")` when anonymous. Public browsing
routes are untouched — nothing public gained an auth wall.

## Login flow (`LoginFlow` client component)

1. Phone step → `POST /api/v1/auth/otp/request` → challenge id +
   resend cooldown.
2. OTP step → `POST /api/v1/auth/otp/verify`. Resend via
   `POST /api/v1/auth/otp/resend`, gated by a visible countdown fed by
   the server's `resend_after_seconds` (never a client guess).
3. On success the browser navigates to the **server-sanitized**
   `return_to` from the verify response (`sanitizeReturnTo` — relative
   paths only), falling back to `/profil`, then `router.refresh()` so
   the server-rendered header re-reads the session.

Error UX maps stable API codes (`OTP_INVALID`, `OTP_EXPIRED`,
`OTP_LOCKED`, `OTP_RESEND_TOO_SOON`, `OTP_RATE_LIMITED`,
`AUTH_INVALID_PHONE`) to Azerbaijani messages; unknown errors collapse
to a generic message. Raw OTPs, session tokens, internal user ids, and
provider errors never reach the UI. `/giris` bounces
already-authenticated visitors to their sanitized destination.

## Session-aware header

`SiteHeader` is an async server component: anonymous → Daxil ol + CTA
pointing at `/giris?return_to=/elan-yerlesdir`; authenticated →
Seçilmişlər / Profil / Çıxış. The mobile drawer receives the same
`authed` flag. Logout POSTs `/api/v1/auth/logout` (cookie cleared
server-side), then navigates home and refreshes.

## Favorites

Backend was the one missing piece (the `favorites` table has existed
since migration 004 — no new migration):

| Endpoint | Notes |
| --- | --- |
| `GET /api/v1/me/favorites` | card DTOs for the session user, `no-store` |
| `GET /api/v1/me/favorites/ids` | public-id list for heart-state bootstrap |
| `PUT /api/v1/me/favorites/{publicId}` | add; idempotent; **404 unless the listing is currently publicly visible** (favoriting a hidden listing would leak its existence) |
| `DELETE /api/v1/me/favorites/{publicId}` | remove; idempotent; always allowed |

Mutations require the session cookie plus the same-origin guard
(`assertSameOrigin`). DTOs expose public fields only (public_id
contract — no internal UUIDs, no seller identity). A saved listing
that later leaves the marketplace stays in the list flagged
`isActive: false` (no signed image), so buyers see honest state
instead of silently shrinking lists.

`FavoriteButton` (card overlay + detail variant) bootstraps its state
from one shared, memoized `/favorites/ids` fetch per page load.
There is deliberately **no** localStorage fallback: an anonymous click
routes to `/giris?return_to=/elan/{publicId}?fav=1`; after login the
detail page's button completes the intended add exactly once and
cleans `fav=1` from the URL. Server state is the only source of truth.

## Testing

- Integration (`tests/integration/favorites-api.test.ts`): auth and
  origin boundaries, visibility rules for add, idempotency, per-user
  isolation, inactive flagging, DTO leak checks.
- E2E (`tests/e2e/auth.spec.ts`, `favorites.spec.ts`): real OTP logins
  made deterministic by rewriting the stored challenge hash with the
  server's own scheme and the e2e-only pepper (production code paths
  untouched); wrong-code/resend/return_to/open-redirect cases; header
  states; logout; anonymous favorite-intent round trip; saved-listings
  page — across desktop/tablet/mobile projects.

## Explicit non-goals (later phases)

Seller wizard (`/elan-yerlesdir` is a stub), moderator/admin UIs,
profile editing (display name), phone change, session/device list.
