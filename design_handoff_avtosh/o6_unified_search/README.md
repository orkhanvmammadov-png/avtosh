# AVTOSH.AZ — O.6 Unified Search & Boosted Results — Developer Handoff
Phase 4.17O.6 · Stage O.6.2 · NEW package — distinct from the sealed O.2 handoff at design_handoff_avtosh/advanced_search/ (do not merge or overwrite either).

## What O.6 is
- **O.2 Direction 1C remains authoritative for filter-control styling** (control geometry, range recipe, price treatment, multi-select system, Kredit/Barter toggles — see the sealed O.2 package). O.6 does not restyle any filter control.
- **O.6 adds the Results-page composition**: the approved Home search experience becomes the unified search interface on Search Results / Cars / Motorcycles.
- **Left filter sidebar: REMOVED.** Reclaimed width goes to the results grid (4-up @1440).
- **"Reklam" section: REMOVED.** No separate Boost section, heading, container, or background anywhere.
- **Boost is integrated into result ordering**: eligible boosted listings open the single deduplicated grid; organic results continue immediately after.
- **BOOST badge is the buyer-facing label** — never Reklam/Sponsored/Promoted.
- **Premium + Boost coexist** on one card (Premium chip + zap-only Boost chip, max 2 badges, top-left).
- **Active filter chips added** below the search panel; removable, wrapping; Təmizlə clears all.
- **Sort remains separate** from filtering, in the chips/toolbar row.
- **Search backend/business semantics unchanged**: API, URL-as-state, filter semantics, Boost matching/rotation, slot policy (4 desktop / 3 tablet / 2 mobile), Premium rules, cursor pagination, listing-card anatomy.

## Files
layout.md · components.md · interactions.md · tokens.md · delta.md · contracts.md · references/ (13 PNGs) · design_files/AVTOSH Unified Search Results.dc.html (inspectable O.6 source).
References are visual aids; the markdown documents + design source are authoritative for measurements.

## Status
Ready for Owner design review. Implementation (Claude Code) proceeds only after owner approval. No application code in this package.