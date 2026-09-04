# Advanced Search (Phase 4.17O.2)

Owner-approved search/filter contract implemented across Home, Search
Results, the search API and the seller data model.

## Year policy

One authoritative rule in `src/lib/config/marketplace.ts`:
`LISTING_YEAR_MIN = 1900`, `listingYearMax()` = current calendar year
in **Asia/Baku + 1** (2027 during 2026). Consumed by the search
validator, the listing/draft validator, and every year picker
(server-computed option lists — no hydration-sensitive client dates).
There are no per-surface maxima.

**Legacy year URLs:** the API validator enforces the new range; the
public web parser (`filtersFromSearchParams`) canonicalizes
out-of-range years from pre-policy bookmarks (e.g. `year_max=2100`)
to the accepted boundary instead of failing the page, and
re-serialized URLs carry the legal value.

## Multi-value URL contract

Canonical params follow the `feature_ids` CSV precedent:

- `fuel_type_ids=<uuid,uuid,…>`
- `transmission_ids=<uuid,uuid,…>`
- `color_ids=<uuid,uuid,…>`

**Legacy singular compatibility:** `fuel_type_id`, `transmission_id`
and `color_id` keep parsing at both the web parser and the API;
singular and plural merge into one deduplicated collection (never
separate filter buckets). After any interaction the plural form is
serialized. One representation serves Home submission, Search
restoration, reload, Back/Forward, shareable URLs and the server
(URLs stay directly forwardable to `/api/v1/listings`).

## Boolean semantics

- **Inside** fuel / transmission / color: OR (`column = ANY(ids)`).
- **Across** filter groups: AND (existing WHERE composition).
- **Vehicle condition** (`no_accident=true`, `not_repainted=true`):
  each selected claim is an independent `column IS TRUE` predicate,
  AND-composed. The web UI emits a condition param only when
  selected — absence means "do not filter on that claim"; `false` is
  never emitted and never filters.

## Vehicle condition data semantics

`listings.no_accident` / `listings.not_repainted` (additive nullable
booleans, migration `20260903100000`): `TRUE` = the seller explicitly
makes the positive claim; `NULL` = no claim / unknown — **all
historical listings stay NULL, never backfilled or inferred**; the
application never writes `FALSE`. Editing: checked → true, unchecked
→ null. Public Listing Detail shows only positive claims (never a
fabricated negative); moderation shows "Qeyd edilib / Qeyd edilməyib".

## Engine displacement search

Operates on the existing `listings.engine_cc` (no schema change).
Params `engine_cc_min` / `engine_cc_max` (0–100000 at the API,
`min ≤ max` enforced); rows with `engine_cc IS NULL` never match a
bounded filter. The filter UI uses the shared 79-value generator
(`engineCcOptions`): 0→6500 step 100, then 500 to 10000, then 1000 to
16000; literal `0` is a real value — the neutral empty option is the
no-filter state. This 0–16000 list is presentation range only.

## Catalog changes (reference data, migration `20260903100100`)

Stable ids/codes preserved everywhere; renames are display-only.

- **Fuel:** ELECTRIC renamed "Elektrik"→"Elektro"; new HYDROGEN,
  PLUGIN_HYBRID, DIESEL_HYBRID. Existing HYBRID listings remain
  generic "Hibrid" — never reclassified.
- **Transmission:** owner decision — the existing broad AUTOMATIC is
  interpreted as the conventional AT category (ROBOT and CVT were
  always separate codes) and displays as "Avtomat (AT)" with its id
  unchanged; MANUAL→"Mexaniki (MT)", ROBOT→"Avtomatik (Robot)",
  CVT→"Avtomat (Variator)"; new DHT and REDUCER. No listing rows
  rewritten.
- **Color:** 8 new options complete the approved 20-color set in the
  owner's exact order.

## Color swatches

Presentation-only hexes live in `reference_options.metadata.swatch`
and flow through the catalog DTO (`ReferenceOptionDto.swatch`).
Swatches always render beside the text label (never swatch-only) with
a subtle border for visibility on light tones. Canonical identity
remains UUID/code — hexes are never identity.

## UI

`MultiSelectField` (shared): disclosure trigger with a selected-values
summary ("Benzin, Hibrid +1") over an inline real-checkbox panel —
native form semantics, keyboard/screen-reader friendly, no nested
dialogs, works in the desktop rail, the mobile filter sheet and the
Home advanced panel. AppliedFilters renders one removable chip per
selected multi value and independent chips for each condition claim.
Price and mileage are manual-only digit-filtered text inputs (no
steppers, no native spinners, no rounding).
