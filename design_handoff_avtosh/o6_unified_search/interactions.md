# Interactions

## Expand / collapse (results mode)
- Toggle "Ətraflı axtarış" opens the 1C panel inline inside the search card; results grid pushes down (240ms ease, optional). Chevron ▼/▲.
- Collapse preserves all values; count chip "n filtr" summarizes persisted criteria. Only Təmizlə resets.

## Apply (Axtar)
1 User edits criteria (panel restored from current query) → 2 Axtar submits → 3 results refresh via existing URL-as-state → 4 **Advanced panel auto-collapses** → 5 chips re-render from the applied query → 6 focus/viewport returns to the results (grid becomes primary again — explicitly required at 390).

## Chips
- ✕ on a chip removes that single criterion and refreshes results (same URL mechanics as un-checking in the panel).
- "Təmizlə" clears all criteria (keeps category context) and refreshes.
- Chip state and panel state are the same state — removing a chip is reflected inside the panel on next open.

## Sort
Independent of filters; changing sort refreshes ordering only, chips untouched. One dropdown open at a time (shares the multi-select open/close contract: outside click, Esc, re-click).

## Boost-first grid
- Initial view: eligible boosted listings (must match category + all active filters) occupy the first slots — 4 @1440, 3 @1024/768, 2 @390 — chosen by the existing deterministic rotation.
- Organic results continue in the same grid immediately after. Zero visual separation beyond badges.
- Deduplication: a boosted listing never re-appears as organic in the same journey.
- "Daha çox göstər" continues organic results on the existing cursor; boost slots are NOT re-inserted on continuation.

## Multi-select / filter controls
All open/close/clear behavior identical to sealed O.2 interactions (one open at a time, Esc, outside click, panel stays open across picks, Təmizlə (n) group clear).