# AVTOSH.AZ — Manual UAT Checklist (Phase 4.17.5)

Manual business acceptance record. Every case must be executed by a
person against `pnpm uat:dev` (see `docs/uat/local-uat.md`).
**Automated test results do not substitute for this checklist.**
Mark exactly one box per case and add notes for anything non-obvious.

## PUBLIC

### UAT-001
- **Actor:** Anonymous buyer
- **Precondition:** —
- **Action:** Open http://localhost:3000
- **Expected Result:** Hero, search card, category tiles, Premium section, trust strip, footer render; no errors
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-002
- **Actor:** Anonymous buyer
- **Precondition:** Seed loaded
- **Action:** Search Avtomobillər; apply brand/price filters; change sort
- **Expected Result:** URL reflects every filter/sort; results update; applied-filter chips removable; boost ad section visually separated
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-003
- **Actor:** Anonymous buyer
- **Precondition:** —
- **Action:** Open SELLER_B 'active' listing from results
- **Expected Result:** Detail with gallery, specs, price, favorite, report action; contact reveal button present
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-004
- **Actor:** Anonymous buyer
- **Precondition:** —
- **Action:** Open 'sold' and 'expired' fixtures by direct URL
- **Expected Result:** Limited non-contactable view with status badge; not present in active search results
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-005
- **Actor:** Anonymous buyer
- **Precondition:** —
- **Action:** Browser Back after opening a listing from filtered search
- **Expected Result:** Original search URL and filters restored
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## AUTH

### UAT-006
- **Actor:** SELLER_A
- **Precondition:** uat:dev terminal visible
- **Action:** Enter +994551000001 on /giris; read code from terminal; verify
- **Expected Result:** Login succeeds; header shows account links
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-007
- **Actor:** Any
- **Precondition:** —
- **Action:** Enter a wrong 6-digit code
- **Expected Result:** Azerbaijani error; retry allowed; attempt limit enforced after repeated failures
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-008
- **Actor:** Any
- **Precondition:** —
- **Action:** Request code again immediately
- **Expected Result:** Resend cooldown message (real throttle, UAT-tuned 15s)
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-009
- **Actor:** Any
- **Precondition:** Logged in
- **Action:** Çıxış
- **Expected Result:** Session ends; protected pages redirect to /giris
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## SELLER

### UAT-010
- **Actor:** SELLER_A
- **Precondition:** Fresh login
- **Action:** Open Elanlarım
- **Expected Result:** Empty state with CTA (account starts with zero listings)
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-011
- **Actor:** SELLER_B
- **Precondition:** Login
- **Action:** Open Elanlarım with each filter tab
- **Expected Result:** All 14 fixtures with correct Azerbaijani status chips and context actions
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## QUOTA

### UAT-012
- **Actor:** SELLER_A
- **Precondition:** 0 publications
- **Action:** Create+submit listing #1 via wizard
- **Expected Result:** FREE — sent to moderation; no payment step
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-013
- **Actor:** SELLER_A
- **Precondition:** 1 publication
- **Action:** Submit listing #2
- **Expected Result:** FREE
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-014
- **Actor:** SELLER_A
- **Precondition:** 2 publications
- **Action:** Submit listing #3
- **Expected Result:** FREE; quota hint shows remaining free count during wizard
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-015
- **Actor:** SELLER_A
- **Precondition:** 3 publications
- **Action:** Submit listing #4
- **Expected Result:** PAYMENT REQUIRED — 2 AZN intent shown; listing waits in Ödəniş tələb olunur
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-016
- **Actor:** SELLER_A
- **Precondition:** Paid #4 via fake Kapital
- **Action:** Re-check listing after verified success
- **Expected Result:** Listing proceeds to moderation; amount snapshot unchanged
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## LISTING WIZARD

### UAT-017
- **Actor:** SELLER_A
- **Precondition:** —
- **Action:** Walk all 5 steps; leave and return mid-way
- **Expected Result:** Autosave restores state; stepper shows completed/current
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-018
- **Actor:** SELLER_A
- **Precondition:** Two tabs on same draft
- **Action:** Edit in tab A, then save in tab B
- **Expected Result:** Stale tab gets the conflict notice with reload action (expected_revision)
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-019
- **Actor:** SELLER_A
- **Precondition:** —
- **Action:** Submit with missing required fields / <3 photos
- **Expected Result:** Azerbaijani validation errors listing what is missing
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## IMAGES

### UAT-020
- **Actor:** SELLER_A
- **Precondition:** In wizard photos step
- **Action:** Upload JPEG/PNG photos; set primary; delete one
- **Expected Result:** Real signed upload; previews appear; primary badge; count enforced
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-021
- **Actor:** SELLER_A
- **Precondition:** —
- **Action:** Try a non-image file or oversized file
- **Expected Result:** Rejected with a clear error; nothing broken
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-022
- **Actor:** Anonymous
- **Precondition:** —
- **Action:** View seeded listings' images publicly
- **Expected Result:** Local WebP images render; no broken alt-text bleed
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## MODERATION

### UAT-023
- **Actor:** MODERATOR
- **Precondition:** pending1 exists
- **Action:** Open /moderator queue
- **Expected Result:** Oldest-first queue; fixture visible with image
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-024
- **Actor:** MODERATOR
- **Precondition:** —
- **Action:** Claim pending1; approve
- **Expected Result:** Durable success panel; listing ACTIVE and public with 30-day validity
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-025
- **Actor:** MODERATOR
- **Precondition:** pending2 unclaimed
- **Action:** Claim; reject with reason + note
- **Expected Result:** REJECTED; seller sees Azerbaijani reason on their card
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-026
- **Actor:** MODERATOR
- **Precondition:** Second staff session (ADMIN) claims a listing
- **Action:** Open same listing as MODERATOR
- **Expected Result:** 'Claimed by other' state; no takeover
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-027
- **Actor:** MODERATOR
- **Precondition:** Approved ACTIVE listing
- **Action:** Suspend from review page with reason
- **Expected Result:** Publicly hidden immediately; suspension recorded in history
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## CORRECTION ROUND-TRIP

### UAT-028
- **Actor:** MODERATOR
- **Precondition:** A pending listing
- **Action:** Request correction with note
- **Expected Result:** Listing → CORRECTION_REQUIRED
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-029
- **Actor:** SELLER_B
- **Precondition:** 'correction' fixture
- **Action:** Open in wizard; see feedback; fix; resubmit
- **Expected Result:** Feedback banner shows moderator note as plain text; resubmission returns to queue without consuming quota
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## PUBLICATION

### UAT-030
- **Actor:** Any
- **Precondition:** Listing just approved
- **Action:** Check public detail + search
- **Expected Result:** Visible with correct data; freshness label correct; 30-day expiry set
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## FAVORITES

### UAT-031
- **Actor:** Anonymous
- **Precondition:** —
- **Action:** Click heart on a card
- **Expected Result:** Redirect to login with return intent; after login the intended favorite completes
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-032
- **Actor:** SELLER_A
- **Precondition:** Logged in
- **Action:** Toggle hearts on cards and detail; open Seçilmişlər
- **Expected Result:** State persists; favorites page lists saved items; unfavorite removes
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## CONTACT

### UAT-033
- **Actor:** Anonymous
- **Precondition:** 'active' fixture
- **Action:** Nömrəni göstər (desktop sidebar and mobile bottom bar)
- **Expected Result:** Number + WhatsApp link revealed only after click
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-034
- **Actor:** Anonymous
- **Precondition:** 'sold'/'expired' fixtures
- **Action:** Look for contact
- **Expected Result:** No contact possible on limited views
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## REPORTS

### UAT-035
- **Actor:** Anonymous
- **Precondition:** 'active' fixture
- **Action:** Şikayət et → reason+note → submit
- **Expected Result:** Confirmation shown; no report id exposed
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-036
- **Actor:** ADMIN
- **Precondition:** Report submitted
- **Action:** Open /admin/hesabatlar
- **Expected Result:** OPEN report visible with listing link; resolve and dismiss work; closed report can't be re-resolved
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-037
- **Actor:** Owner (terminal)
- **Precondition:** Guide §12
- **Action:** Run the two X-Forwarded-For curl commands
- **Expected Result:** 1st → 200, 2nd → 429 REPORT_RATE_LIMITED
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## LISTING_FEE PAYMENT

### UAT-038
- **Actor:** SELLER_A
- **Precondition:** Listing #4 payment required
- **Action:** Pay on fake HPP with Ödə
- **Expected Result:** Return page verifies server-side → success; listing proceeds; refresh does not double-charge/fulfil
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-039
- **Actor:** SELLER_A
- **Precondition:** Another payable intent
- **Action:** Choose İmtina on HPP
- **Expected Result:** Non-success state on return page; retry path offered; nothing fulfilled
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## PREMIUM

### UAT-040
- **Actor:** SELLER_B
- **Precondition:** 'active' fixture
- **Action:** İrəli çək → Premium package → pay
- **Expected Result:** Server-priced package; after verified success listing appears in home Premium band with gold badge
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## BOOST

### UAT-041
- **Actor:** SELLER_B
- **Precondition:** Another ACTIVE listing
- **Action:** Buy Boost
- **Expected Result:** After success the listing rides the boost ad section in matching search; never violates filters
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## PREMIUM + BOOST

### UAT-042
- **Actor:** Any
- **Precondition:** 'both' fixture
- **Action:** View home + search + detail
- **Expected Result:** Both badges present simultaneously; owner card shows both until-dates
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-043
- **Actor:** SELLER_B
- **Precondition:** Existing active Premium
- **Action:** Buy Premium again on same listing
- **Expected Result:** New duration queued AFTER current period (extension, not overlap)
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## EXPIRY

### UAT-044
- **Actor:** Anonymous
- **Precondition:** 'expiryDemo' before job
- **Action:** Search for it
- **Expected Result:** Absent from active results though status still ACTIVE (time fail-safe)
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-045
- **Actor:** Owner (terminal)
- **Precondition:** —
- **Action:** Run expire-listings job (guide §11)
- **Expected Result:** Response counts it; status now EXPIRED; owner card shows Müddəti bitib / Yenilə
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## RENEWAL

### UAT-046
- **Actor:** SELLER_B
- **Precondition:** 'expired' fixture
- **Action:** Yenilə → confirm 2 AZN/30 gün → fake Kapital → success
- **Expected Result:** 'Elan yeniləndi' with new date; same public №; live again; My Listings Aktiv
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-047
- **Actor:** SELLER_B
- **Precondition:** ACTIVE listing
- **Action:** Open its /yenile URL directly
- **Expected Result:** Safe 'not available' state — renewal only for expired
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## WHATSAPP REMINDERS

### UAT-048
- **Actor:** Owner (terminal)
- **Precondition:** 'reminder' fixture
- **Action:** Run send-reminders once
- **Expected Result:** Response scheduled:3; run again → scheduled:0 (dedupe)
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-049
- **Actor:** Owner (terminal)
- **Precondition:** Rows scheduled
- **Action:** pnpm uat:reminder-due, then send-reminders again
- **Expected Result:** sent:3; dev_notification_accepted lines in server log (fake provider, not real delivery)
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## MODERATOR RBAC

### UAT-050
- **Actor:** SELLER_A
- **Precondition:** Plain user session
- **Action:** Open /moderator and /admin
- **Expected Result:** Both 404 — no existence disclosure
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-051
- **Actor:** MODERATOR
- **Precondition:** —
- **Action:** Open /admin
- **Expected Result:** 404; moderator portal itself works
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## ADMIN

### UAT-052
- **Actor:** ADMIN
- **Precondition:** —
- **Action:** Walk dashboard, users, listings, payments, packages, catalog, reports, audit, settings
- **Expected Result:** All pages render with data; navigation and pagination work
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-053
- **Actor:** ADMIN
- **Precondition:** 'suspended' fixture
- **Action:** Unsuspend from admin listing detail
- **Expected Result:** Restored to ACTIVE (period still valid); publicly visible; audit row created
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-054
- **Actor:** ADMIN
- **Precondition:** SELLER_B
- **Action:** Block, verify seller loses posting, unblock
- **Expected Result:** Blocked user keeps read access; mutations refused; unblock restores; audit shows both
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## ADMIN RBAC

### UAT-055
- **Actor:** ADMIN
- **Precondition:** —
- **Action:** Look for Admin təyin et on a user; also try SUPER_ADMIN-only actions
- **Expected Result:** Controls absent; boundary enforced
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-056
- **Actor:** SUPER_ADMIN
- **Precondition:** —
- **Action:** Grant/revoke ADMIN on STAFF_CANDIDATE
- **Expected Result:** Works and is audited
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## STAFF ROLE MANAGEMENT

### UAT-057
- **Actor:** SUPER_ADMIN
- **Precondition:** STAFF_CANDIDATE is USER
- **Action:** Grant MODERATOR
- **Expected Result:** Candidate can open /moderator and act
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-058
- **Actor:** SUPER_ADMIN
- **Precondition:** Candidate is MODERATOR
- **Action:** Revoke MODERATOR
- **Expected Result:** Candidate gets 404 on /moderator again
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## PAYMENT OPERATIONS

### UAT-059
- **Actor:** ADMIN
- **Precondition:** A PENDING payment exists (decline a checkout first)
- **Action:** Open payment detail; Provayderdə yoxla
- **Expected Result:** Attempt history visible; verification runs the real provider path; no secrets shown anywhere
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-060
- **Actor:** Owner (terminal)
- **Precondition:** Stale pending payment
- **Action:** Run reconcile-payments job
- **Expected Result:** Summary JSON; no duplicate fulfillment on repeats
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## PROMOTION PRICING

### UAT-061
- **Actor:** ADMIN
- **Precondition:** —
- **Action:** Change a package price; then buy as SELLER_B
- **Expected Result:** New purchases use the new price; previously created intents keep their snapshot
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-062
- **Actor:** ADMIN
- **Precondition:** Two tabs on same package
- **Action:** Save price in both
- **Expected Result:** Second save gets the conflict panel (optimistic concurrency)
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-063
- **Actor:** ADMIN
- **Precondition:** —
- **Action:** Deactivate a package
- **Expected Result:** It disappears from the seller purchase page
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## SETTINGS

### UAT-064
- **Actor:** ADMIN
- **Precondition:** —
- **Action:** Edit a bounded setting (e.g. boost slots); try an out-of-range value
- **Expected Result:** Valid value saves with confirmation; invalid rejected; audit row written
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## CATALOG

### UAT-065
- **Actor:** ADMIN
- **Precondition:** —
- **Action:** Deactivate a brand; check seller wizard and filters
- **Expected Result:** Brand vanishes from future choices; existing listings unaffected; reactivate restores
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## AUDIT

### UAT-066
- **Actor:** ADMIN
- **Precondition:** Actions performed above
- **Action:** Filter audit by action/entity
- **Expected Result:** Matching entries with actor type and data; log is read-only
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## RESPONSIVE

### UAT-067
- **Actor:** Owner
- **Precondition:** Browser devtools
- **Action:** Test Home/Search/Detail/Wizard/My Listings/Payment at 390, 768, 1024, 1440
- **Expected Result:** No horizontal page scroll; filters drawer <1024, rail ≥1024; mobile contact bar on detail; sticky search toolbar on mobile
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-068
- **Actor:** Owner
- **Precondition:** 390 width
- **Action:** Staff portals
- **Expected Result:** Nav strips scroll with edge fade; tables scroll inside their container
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

## SECURITY / IDOR

### UAT-069
- **Actor:** SELLER_A
- **Precondition:** Copy a SELLER_B listing id
- **Action:** Open its wizard/renewal/promotion URLs as SELLER_A
- **Expected Result:** 404 — indistinguishable from missing; no data leak
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-070
- **Actor:** Owner (terminal)
- **Precondition:** —
- **Action:** curl a /api/jobs/* endpoint without Authorization
- **Expected Result:** 401; with wrong bearer → 401
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-071
- **Actor:** Anonymous
- **Precondition:** —
- **Action:** Try /admin/* and /moderator/* deep URLs
- **Expected Result:** Redirect to login (anonymous) or 404 (wrong role); API calls refused server-side
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

### UAT-072
- **Actor:** Any
- **Precondition:** Report/contact endpoints
- **Action:** Try a hidden (draft/suspended) listing's public № on report/contact
- **Expected Result:** Uniform 404 — no hidden-listing oracle
- **Result:** [ ] PASS [ ] FAIL [ ] BLOCKED
- **Notes:**

