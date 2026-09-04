# AVTOSH.AZ — Home Advanced Search (Direction 1C) — Developer Handoff
Phase 4.17O.2 · Stage 3 · Owner visual sign-off: PASS

## Authority
- **Visual/UX source of truth:** this handoff + the approved Stage 2 frames in `AVTOSH Advanced Search.dc.html` (section 2a — developer-inspectable HTML; open in the design project to measure).
- **Functional source of truth:** existing AVTOSH codebase. Preserve unchanged: search params, DB/catalog IDs, year policy (1900→currentYear+1), engine option sequence, multi-select OR semantics, condition AND semantics, Kredit/Barter semantics, URL-as-state + legacy singular URL compat, outside-click/Escape/one-open-at-a-time, category scoping, Back/Forward/reload, Boost, ranking, cursor pagination.
- Scope: Home "Ətraflı axtarış" only. Do not restyle Search Results, wizard, staff, auth, or detail; if a shared control component is touched, gate the visual change to Home usage.

## Files
- `layout.md` — reading order, breakpoint sheets (1440/1024/768/390), grid/flex recommendation, states (collapsed/expanded/selected)
- `components.md` — field wrapper, closed control, range recipe, Price block, Kredit/Barter toggles, numeric inputs, multi-select system + interaction contract, swatches, condition block, city, actions
- `tokens.md` — typography, spacing, color/surface, radius/shadow, icons, accessibility, animation
- `delta.md` — MUST/SHOULD/POLISH, current-code KEEP/CHANGE/REMOVE, risks, final report answers

## Screenshots (reference only)
`references/` — captures of the approved Stage 2 frames: 1440 collapsed/default/selected/multiselect-open, 1024 default/selected, 768 default/selected, 390 collapsed/default/selected-open. Captured from the live canvas at its current zoom, so pixel dimensions may differ from the nominal frame widths — the docs and the inspectable `design_files/AVTOSH Advanced Search.dc.html` (section 2a) are authoritative for all measurements.

## Final report (§41 summary)
1C fully specified at all four widths: YES. One closed-control geometry: YES (h40 desktop / h44 @390). Year=Engine=Price Min/Max geometry: YES (non-negotiable). Price emphasized without oversizing: YES (spine/band treatment). Kredit+Barter inside Price: YES. One multi-select system for Fuel/Transmission/Color: YES. Condition is the final block: YES. CAR reading order preserved: YES (DOM order mandated). Implementable without inventing decisions: YES. Unresolved visual blockers / open design questions: NONE.