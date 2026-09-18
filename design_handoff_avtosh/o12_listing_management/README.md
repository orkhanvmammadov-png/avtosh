# AVTOSH.AZ — O.12 Seller Listing Management (Edit · Deactivate · Reactivate) — Developer Handoff
PHASE: 4.17O.12 · STAGE: O.12.4 · STATUS: O.12.1 product lifecycle SEALED · O.12.2 architecture SEALED · O.12.3 visual PASS/SEALED · Package O.12.4 final (2026-09-17).

## Purpose
Translate the approved O.12.3 design (edit ACTIVE/DEACTIVATED/EXPIRED listings, seller deactivate/reactivate, cancel edit, moderator edit review with before/after diff) into an implementation-ready package.

## Authority order
1. O.12.1 product lifecycle · 2. O.12.2 technical architecture · 3. O.12.3 approved design (this package) · 4. existing code behavior for anything not explicitly changed.

## Sources
Design source: design_files/AVTOSH Seller Flow.dc.html — section "4b — O.12 SELLER LISTING MANAGEMENT" (4a=O.11, 3a=O.10, 2a=O.9 all sealed, untouched). Visual system: Direction C / AXIN. References: references/{seller,axin,moderator,mobile}/ — 23 PNGs, visual aids; the markdown files are authoritative for exact behavior.

## Files
01-state-matrix · 02-my-listings · 03-axin-edit-mode · 04-reactivation-flows · 05-cancel-edit · 06-moderator-diff · 07-responsive · 08-accessibility · 09-copy · 10-api-state-contracts · 11-component-map · 12-visual-delta