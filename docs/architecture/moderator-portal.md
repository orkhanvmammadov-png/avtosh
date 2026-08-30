# AVTOSH.AZ — Moderator Portal (Phase 4.14)

Date: 2026-08-27
Status: implemented (Admin Panel, report management, and moderator
administration are later phases)

The portal is a UI over the accepted Phase 4.7 moderation backend —
no moderation business rule lives in React; every command re-runs the
server's RBAC, claim, and revision checks.

## Routes & RBAC

| Route | Purpose |
| --- | --- |
| `/moderator` | redirect to the queue |
| `/moderator/elanlar` | moderation queue (server-rendered first page) |
| `/moderator/elanlar/[listingId]` | review screen |

Guard (`requireStaffPage`): anonymous → `/giris?return_to=…`;
authenticated non-staff and BLOCKED staff → plain 404 (no portal
existence disclosure). The layout AND every page run the guard; every
API call independently re-authorizes via `requireStaff` (active +
not blocked + role ∈ MODERATOR/ADMIN/SUPER_ADMIN). The staff shell is
separate from the public header, shows only the coarse role label
(Moderator/Admin), and contains no admin controls — MODERATOR gains
no pricing/refund/role/settings capability anywhere.

## Queue

`GET /moderator/listings`: PENDING_MODERATION only, oldest-first
(`submitted_at ASC, id ASC`), microsecond-safe base64url keyset
cursor. The portal renders the first page in a Server Component and
continues via the same API ("Daha çox göstər") — ordering is never
recomputed client-side, and there is no per-row fetching. Rows show
title/category/price/city/submitted time/primary image and a
"Nəzarətdə" chip; seller PII beyond the masked summary is not shown.
Null/failed image signing renders a placeholder (Phase 4.8
resilience preserved; null-`submitted_at` rows are structurally
excluded by the accepted queue query).

## Claim model

Soft claims, 600 s TTL (`MODERATION_CLAIM_TTL_SECONDS`), strict
claim-required decisions, one live claim per listing (partial unique
index), same-moderator retry extends, expired claims replaceable.
The review screen derives three states server-side — claimed by me
(with expiry time), claimed by another moderator (no identity beyond
the fact), free — and exposes only booleans to the client. A takeover
attempt is refused by the backend (`MODERATION_CLAIMED_BY_OTHER`) and
surfaces as a safe "başqa moderator tərəfindən götürüldü" state with
refresh; no optimistic ownership exists. Claim races are
backend-arbitrated (Phase 4.7 regression: concurrent claims → one
winner) with portal E2E covering the loser's UX.

## Review & decisions

The review screen uses the authenticated moderation DTO exclusively
(a pending listing is never fetched through the public API): specs,
description, contact field, masked seller summary, signed image
gallery with primary tag and placeholders (raw storage paths never
leave the server), submission time, and the moderation history
(decision + Azerbaijani reason label + seller-safe note + time — no
moderator identity, claim rows, or internal ids rendered).

**Deterministic post-decision UX:** a successful decision renders a
DURABLE success panel ("… təsdiqləndi/rədd edildi/…") with explicit
next actions — "Moderasiya növbəsinə qayıt" and "Cari vəziyyətə bax"
— and performs NO automatic refresh or navigation, so the outcome is
always user-observable. The portal deliberately contains no
`router.refresh` at all: claim success and conflict recovery use FULL
document reloads (an in-flight RSC refresh stream raced the
moderator's next interaction on loaded runners — swallowed clicks or
stale-revision submissions), and every workbench control is disabled
until hydration so a click on a freshly loaded page can only land on
a live handler.

Commands — the only mutations the UI can perform:

| Action | Endpoint | Requirements |
| --- | --- | --- |
| Təsdiqlə | `POST …/approve` | claim + `expected_revision` |
| Rədd et | `POST …/reject` | claim + revision + reason code (+ note) |
| Düzəliş tələb et | `POST …/request-correction` | claim + revision + reason (+ note) |
| Dayandır | `POST …/suspend` | staff + revision + reason (+ note); ACTIVE listings |

Reason codes are the accepted `MODERATION_REASON_CODES` enum; the UI
shows Azerbaijani labels (the same map the seller side uses) while
the stable code is what is stored. Every decision uses a deliberate
two-step confirmation (no modal library). Approval activation
(initial period, `published_at`, `current_expires_at`) is computed
entirely by the backend.

## Concurrency & conflicts

`expected_revision` from the loaded page accompanies every decision.
Stale revision → "Elan dəyişdirilib. Son versiyanı yeniləyin." with
explicit reload (nothing retried or overwritten). Competing decisions
keep the Phase 4.7 invariant — exactly one wins, the loser receives
`MODERATION_INVALID_STATE` and sees "Bu elan üzrə qərar artıq
verilib." + the current state after refresh; no duplicate review or
period can exist (idempotent-retry rules unchanged).

## Suspension (gap closed)

Suspension is an accepted moderator capability (CLAUDE.md) that had
no command; Phase 4.14 adds the smallest one:
`POST /moderator/listings/:id/suspend` `{expected_revision,
reason_code, note?}` for ACTIVE listings → `SUSPENDED` inside one
transaction with the listing row locked: MODERATOR status-history
row, append-only `audit_logs` entry (`LISTING_SUSPENDED`, reason +
note as data), outbox event. Effects: the listing disappears from
every public read (status alone controls `publicVisible()`); paid
listing/promotion time is NOT modified and nothing is refunded —
promotion periods simply stop being publicly effective while hidden.
Idempotent retry returns the current state without duplicate side
effects. Claims do not apply (they are queue coordination for
PENDING_MODERATION). No unsuspension flow exists — none is accepted;
that is an Admin-phase decision. `moderation_reviews.decision` is an
accepted immutable enum without a SUSPENDED value, so suspension is
recorded via history + audit rather than a review row (documented
deliberately).

Discovery note: suspension is reachable from the review screen by
listing id; a dedicated ACTIVE-listing search/report-driven entry
point belongs to the reports/admin phases.

## Reports — documented gap

`listing_reports` exists in the accepted schema (Phase 4.2) but has
no APIs, services, or write path yet. No report UI was invented; the
moderator detail shows no report context. Report intake + management
is a later phase working against the existing table.

## Rendering safety

Seller descriptions and staff notes render as escaped plain text
(React default, `whitespace-pre-line`; no `dangerouslySetInnerHTML`
anywhere in the portal). Regression: a `<script>` note is stored
verbatim as data and appears as literal text for both moderator
history and the seller wizard banner, with an E2E assertion that no
script element exists.

## Responsive & accessibility

Desktop-first dense workbench; validated 390/768/1024/1440 with no
horizontal overflow; the decision panel is sticky on desktop and
stacks on narrow screens with all functions available. Landmarks,
labelled controls, 48 px targets, `aria-live` claim feedback,
non-color state chips + text, focus-visible styling, and text-based
conflict states.

## Tests

Integration: the Phase 4.7 suite (queue ordering/cursor, claims and
claim races, decisions, approve-vs-reject one-winner, revision
conflicts, history) remains authoritative; Phase 4.14 adds the
suspension suite (RBAC matrix incl. blocked staff, public hiding,
exactly-once history/audit/outbox, promotion-time preservation,
invalid-state/stale/unknown-id safety, hostile-note storage). E2E
(9 scenarios × 3 viewports): access control (anonymous redirect,
USER 404, blocked 404), queue with null-image fallback + pagination,
approve round-trip to the live public page with exactly one period,
correction round-trip to the seller's accepted Phase 4.11 projection
with XSS-escaping assertions, reject + history, claim contention UX,
competing-decision conflict, stale-revision reload-and-retry,
suspension to public 404. Visual-review captures desktop+mobile.
