# Design ↔ Functional contract (freeze list)
| Design element | Functional contract preserved |
| --- | --- |
| Unified search card | Existing search API + URL-as-state (incl. legacy singular params); restored selections come from the URL |
| Axtar (results mode) | Same submit path as today; only the presentation (auto-collapse + chips) is new |
| Active chips | Each chip maps 1:1 to an existing query param; removal = param removal + refresh |
| Sort | Existing sort options/params only; separate from filter state |
| Boost-first slots | Existing eligibility (category + brand/model + all active filters), deterministic rotation, slot policy 4/3/2 by width |
| Deduplication | Combined result set assumed deduplicated server-side (existing behavior) |
| Daha çox göstər | Existing cursor continuation; no boost re-insertion; no numbered pagination |
| BOOST / PREMIUM badges | Existing promotion flags; no new states; buyer-facing label fixed to BOOST |
| Listing card | R.2 card contract incl. hydration-safe freshness |
| Category tabs | Existing category scoping; moto filter set from catalog contract |
No backend, DB, catalog, payment, ranking, or business-logic changes are implied by this package.