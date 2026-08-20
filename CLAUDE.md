# AVTOSH.AZ — Claude Code Project Instructions

## Product
AVTOSH.AZ is an Azerbaijan-focused responsive web marketplace for cars and motorcycles.
It is WEB ONLY. Do not create native iOS or Android applications.

## Development Philosophy
This project is architecture-first.
Never invent or silently change business rules.
If implementation conflicts with documented architecture, stop and explain the conflict before changing the design.
Prefer the simplest production-ready MVP solution.
Do not introduce unnecessary microservices or infrastructure.

Before non-trivial work:
1. Read relevant project documentation.
2. Inspect existing code.
3. Produce a short implementation plan.
4. Identify affected database/API/business rules.
5. Implement the smallest complete scope.
6. Add/update tests.
7. Run typecheck, lint, tests, and build.
8. Summarize changes and remaining risks.

## Technology Stack
Frontend: Next.js, TypeScript, Tailwind CSS
Validation: Zod
Backend: Next.js server layer, REST API under /api/v1
Database: Supabase PostgreSQL
Storage: Supabase Storage
Authentication: Custom WhatsApp OTP
Session: Secure opaque session, HttpOnly cookie, Secure in production, SameSite=Lax; store only token hash
Infrastructure: GitHub, Vercel, Cloudflare
Analytics: PostHog, GA4
Monitoring: Sentry

## User Identity
Business-level unique user identifier: mobile phone number.
Normalize to E.164, e.g. +994501234567.
Database relationships must use users.id UUID as foreign keys.
users.phone_e164 must be UNIQUE NOT NULL.

## Authentication
Registration and login are the same flow:
phone → WhatsApp OTP → verify → find/create user → secure session.
Never store plaintext OTP.
OTP requires expiration, attempt limits, resend limits, phone-level rate limiting, and IP-level abuse protection.
Do not disclose whether a phone already has an account.

## Roles
USER, MODERATOR, ADMIN, SUPER_ADMIN
Authorization must always be enforced server-side.
Never rely on UI visibility for authorization.

## Listings
Categories: CAR, MOTORCYCLE
Statuses:
DRAFT
PAYMENT_REQUIRED
PAYMENT_COMPLETED
PENDING_MODERATION
CORRECTION_REQUIRED
REJECTED
ACTIVE
SUSPENDED
SOLD
EXPIRED
DELETED

Only ACTIVE listings with current_expires_at > NOW() may appear publicly.

## Free Listing Business Rule
First 3 NEW listings published by a user are free.
Publication #4 and every subsequent new listing costs 2 AZN.
This is a lifetime publication count.
Deleting does NOT restore a free listing.
Editing is NOT a new publication.
Rejecting/resubmitting is NOT a new publication.
Renewing is NOT a new publication.
Free quota allocation must be concurrency safe.
Do not use a decrementable free_listings_left field as source of truth.

## Listing Validity
Approved listing validity: 30 days.
Use published_at and current_expires_at.
Public queries must always require status = ACTIVE AND current_expires_at > NOW().

## Renewal
An EXPIRED listing can be renewed for 2 AZN for another 30 days.
Keep same listing ID/history/publication identity.
Create a new listing_period record.

## Listing Editing
Low-risk edits may remain ACTIVE:
price, mileage, description, features, credit availability, barter availability.

High-risk identity edits must return to moderation:
category, brand, model, year, VIN if supported, primary/material vehicle photos, other identity changes.

## Moderation
All first publications require moderation.
Moderator may approve, reject, request correction, suspend, review reports, and see relevant seller/listing history.
Moderator may not change pricing, issue refunds, manage admins, or change monetization settings.
Record moderation actions.
Use listing revisions to prevent stale approvals.

## Payments
Types: LISTING_FEE, RENEWAL, BOOST, PREMIUM
Statuses: CREATED, PENDING, SUCCESS, FAILED, CANCELLED, REFUNDED
Never trust client-supplied price.
Resolve prices server-side.
Fulfillment only after verified provider confirmation/webhook.
Browser redirect is NOT payment proof.
Webhook processing must be idempotent.
provider_transaction_id should be unique when available.
Store webhook/event IDs for deduplication.
Use hosted payment pages.
Never store PAN, CVV, or 3DS OTP.

## Promotions
Types: PREMIUM, BOOST
A listing can have both simultaneously.

Premium:
- all active Premium listings are eligible for Home feed
- no fixed total slot limit
- use lazy/cursor pagination
- prevent duplicate listing cards across adjacent Premium periods

Boost:
- applies to search
- must never violate user filters
- category always applies; brand/model must match when selected
- default first-view capacities: Desktop 4, Tablet 3, Mobile 2
- values configurable
- use fair/deterministic rotation

If same promotion type is repurchased while time remains, new duration starts after existing active/scheduled time.
Keep separate purchase/promotion history.

## Notifications
WhatsApp expiry reminders: 7, 5, 3, 1 days before expiry.
Schedule against listing_period_id.
Creation and sending must be idempotent.
Do not send if listing is no longer eligible.
Suggested send time: 10:00 Asia/Baku.
Use TIMESTAMPTZ.

## Favorites
Favorites supported in MVP.
Unique: user_id + listing_id.

## Images
Recommended minimum 3; configurable maximum 20.
Use signed uploads.
Validate MIME type, file signature, size, dimensions.
Do not trust extensions.
Strip EXIF.
Prefer WebP/AVIF re-encoding.
Do not accept SVG as listing photography.

## API
Version: /api/v1
Use standard success/error formats and stable machine-readable error codes.
Do not expose raw DB errors, stack traces, or provider secrets.
Use Zod validation and DTOs.
Do not expose DB models directly.

## Security
Frontend is untrusted.
All authorization happens on the server.
Protect against IDOR, CSRF, XSS, SQL injection, OTP brute force, webhook replay, abusive uploads, and excessive API limits.
Never expose the Supabase service-role key or production secrets.

## Audit
Audit logs are append-only.
Audit: moderation, user block/unblock, refunds, pricing/settings/role changes, listing suspension/deletion, catalog deactivation.
Application must never UPDATE or DELETE existing audit log entries.

## Database
Use UUID PKs for major business entities, timestamptz, numeric/minor currency units where appropriate, FKs, unique/check constraints, and indexes.
Use snake_case.
Never modify a migration already applied to shared environments.
Create a new migration.
Avoid destructive one-step migrations.

## Async Work
Expected jobs:
listing expiration
promotion expiration
WhatsApp notification sending
payment reconciliation
outbox processing
stale session cleanup
stale payment cleanup
All jobs must be idempotent.

## Analytics
Do not send PII to PostHog or GA4.
Critical business events such as payment_success, listing_approved, listing_activated, listing_expired, renewal_success, premium_activated, and boost_activated should originate server-side.
PostgreSQL is the source of truth for financial and operational metrics.

## Development Rules
Do not make unrelated refactors.
Do not install dependencies without justification.
Do not change architecture/business rules merely to simplify implementation.
Do not directly modify production infrastructure.
Do not create/apply destructive SQL without explicitly calling it out.
When uncertain, STOP and describe the ambiguity.

## Definition of Done
A task is complete only when applicable:
- implementation complete
- TypeScript passes
- lint passes
- unit/integration tests pass
- build passes
- authorization tested
- validation tested
- error paths tested
- migration included if required
- docs updated if contract changed
- no secrets committed

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
