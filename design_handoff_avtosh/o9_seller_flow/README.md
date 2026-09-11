# AVTOSH.AZ — O.9 Seller Listing Creation (AXIN) — Developer Handoff
PHASE: 4.17O.9 · SURFACE: Seller Listing Creation · DIRECTION: 1C — AXIN · OWNER STATUS: Approved / Sealed (O.9.2R responsive sign-off)

## Authority
- This O.9 handoff = visual/UX authority for Seller Listing Creation (Quick Start, progressive form, photos, seller contact, review, listing-fee state, Premium/Boost selection).
- The current AVTOSH application = functional/business authority.
- Unresolved backend assumptions are marked AUDIT DEPENDENT throughout (see contracts.md §Audit) — Claude Code must audit before implementing them.
- Global AVTOSH design system (R.2) remains authoritative outside this surface. Sealed sibling packages untouched: advanced_search/ (O.2), o6_unified_search/ (O.6), o7_listing_detail/ (O.7).

## Package
- Version: O.9.3 final (2026-09-11).
- Archive: AVTOSH_O9_Seller_Flow_AXIN_Handoff.zip → extract into design_handoff_avtosh/o9_seller_flow/.
- References: references/ — 30 PNGs of the approved O.9.2R states, visual aids only; markdown + design source are authoritative. Index: 1440 quick-start, main-form, photos, contact, review-free, review-paid, review-paid-promotion-dual, promotion-none/-premium/-boost/-dual · 1024 main + contact · 768 main + contact · 390 quick-start, main, brand-model, photos, contact, validation, review, listing-free, listing-free-promotion, listing-paid, promotion, promotion-dual · close-ups: contact-phone-states, photo-primary-reorder, promotion-cards, autosave-states. Notes: quick-start/photos/promo-package frames are the sealed AXIN components carried unchanged from the selected 1C into O.9.2R; 1024-main/768-main show the full frame (contact files crop the same frame's section card); promotion state variants are captures of the approved card component in its documented selection states.
- Design source: design_files/AVTOSH Seller Flow.dc.html — section "2a — O.9.2R AXIN RESPONSIVE REFINEMENT" is authoritative; turn-1 directions (1a/1b/1c) are exploration archive only.

## Files
flow.md · layout.md · components.md · interactions.md · responsive.md · states.md · validation.md · contact.md · promotions.md · tokens.md · contracts.md · delta.md