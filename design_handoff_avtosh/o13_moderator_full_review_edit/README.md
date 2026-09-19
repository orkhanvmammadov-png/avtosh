# AVTOSH.AZ — O.13 Moderator Full Review & Edit-before-Approve — Developer Handoff
PHASE: 4.17O.13 · STAGE: O.13.4 · Package final (2026-09-19) → design_handoff_avtosh/o13_moderator_full_review_edit/

## Authority order (higher wins)
1. O.13.1 Product & Moderation Definition (SEALED)
2. O.13.2 Technical Audit (FINAL PASS)
3. O.13.2 ChatGPT Architecture Corrections (SEALED — see below)
4. O.13.3 Owner-approved UX (this package's visual authority)
5. Existing O.12 implementation for unchanged behavior
6. Existing code for unspecified details

## Sealed architecture corrections (must be reflected in implementation)
A. Seller submission snapshot is IMMUTABLE per moderation pass — both NEW_LISTING and LISTING_EDIT.
B. Moderator working edits NEVER directly mutate listings submitted content, listing_edit_revisions.data, or listing_edit_images.
C. Moderator adjustment = ONE private full working snapshot.
D/E. Submitted snapshot freezes on FIRST moderator save for NEW and for LISTING_EDIT alike (never rely on live revision data — seller may edit the same revision during CORRECTION_REQUIRED).
F. Adjustment has its OWN revision counter.
G. Every adjustment save emits append-only attribution/audit: adjustment id, adjustment revision, actor, deterministic changed-field delta, timestamp (event: MODERATION_ADJUSTMENT_SAVED).
H. Claim takeover never erases previous moderator authorship.

## Sources
Design source: design_files/AVTOSH Seller Flow.dc.html — section "5 — O.13 MODERATOR FULL REVIEW & EDIT" (all prior sections sealed). References: references/{new,edit,takeover,mobile}/ — 11 PNGs, visual aids; photo-plan and equipment states are embedded in the edit-mode references (no separate photos/equipment folders); markdown is authoritative.

## Files
01-full-review-ia · 02-edit-mode · 03-new-adjustment · 04-listing-edit-adjustment · 05-equipment · 06-photos · 07-takeover-conflicts · 08-decisions-history · 09-responsive · 10-accessibility · 11-copy-contract · 12-api-state-contracts · 13-component-map · 14-visual-delta-non-goals

## Recommended implementation order (stages only, no code here)
O.13.5A Full Moderator Data Read Model → O.13.5B Moderator Edit Foundation → O.13.5C NEW Edit-before-Approve → O.13.5D LISTING_EDIT Edit-before-Approve → O.13.5E Audit/Concurrency/Hardening → O.13.5F Final UAT/Validation.

## Handoff QA (verified)
Full seller data coverage ✓ equipment ✓ contact ✓ NEW two-way ✓ EDIT three-way ✓ no seller-artifact mutation ✓ immutable submitted snapshot ✓ adjustment snapshot ✓ image plan ✓ no moderator upload ✓ claim takeover ✓ multi-moderator attribution ✓ unsaved protection ✓ approve/correction/reject semantics ✓ responsive ✓ accessibility ✓ non-goals ✓.