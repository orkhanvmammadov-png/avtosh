# Before → After (essential for implementation)

## BEFORE (current production)
- Results page: permanent LEFT FILTER SIDEBAR + results area.
- Separate "Reklam" section/heading holding Boost listings above/apart from organic results.
- Duplicated presence possible: listing in Reklam block AND organic grid.

## AFTER (O.6)
- Unified search card (Home 1C experience) on top — collapsed by default, restored from query.
- Active filter chips + Sort toolbar under it.
- ONE full-width results grid: boost-first (badge-marked), organic continuation, deduplicated.
- Load more continues organic only.

## KEEP
Search API + URL semantics · filter semantics + order 1–10 + city-as-general · Boost matching/rotation/slot policy (4/3/2) · Premium rules · cursor pagination ("Daha çox göstər") · listing-card anatomy · O.2 filter-control visuals and interaction contract.

## CHANGE
Remove sidebar entirely (grid takes the width: 4-up @1440) · replace results-page filter UI with the 1C unified search card (results mode: restored values, auto-collapse on apply, count chip) · add chips toolbar + relocated Sort · merge Reklam listings into the main grid as boost-first with BOOST badges · Premium+Boost dual-badge treatment.

## REMOVE
Left sidebar component (results pages) · "Reklam" heading/section/container and any separate Boost grid · any Sponsored/Promoted wording · any duplicate rendering of a boosted listing as organic.

## Risks → expected outcome
- Boost slot fill when few eligible boosts: fewer badges, organic simply starts earlier — no placeholder slots.
- Chip/panel state sync: chips derive from the same URL state as the panel; no second store.
- Panel auto-collapse: must not scroll-jump; keep the toolbar visible after refresh.
- Moto context: conditional CAR-only fields — reuse existing catalog contract, no new flags.
- 4-up grid at 1440: card min width stays comfortable within 1360 max content; below that fall to 3-up per breakpoints.