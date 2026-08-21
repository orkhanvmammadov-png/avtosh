# Public Web UI — Home / Search / Listing Detail (Phase 4.9)

Date: 2026-08-21
Status: implemented (buyer-facing public experience; seller, auth,
favorites, staff UIs are later phases)

## Routes

| Route | Component type | Data |
| --- | --- | --- |
| `/` | Server | `homeData()` + default-category brands |
| `/elanlar` | Server | URL params → `searchQuerySchema` → `searchMarketplace()`, catalog lookups for filter controls |
| `/elan/[publicId]` | Server | `publicDetail()` by `public_id` (UUIDs never appear in URLs) |
| `not-found` | Server | generic "Elan tapılmadı" for every non-public state |

The Home page lives in the `(home)` route group so its `loading.tsx`
Suspense boundary does not wrap `/elan`, letting `notFound()` emit a
true 404 status (a root-level loading boundary would stream a 200).

## Server / Client boundary

Pages are Server Components calling the accepted services directly
(no self-HTTP, no duplicated marketplace rules). Client Components
only where interaction requires: `HomeSearch` (dependent brand →
model selects), `SearchFilters` (desktop sidebar + native `<dialog>`
drawer), `SortSelect`, `SearchResults` and `PremiumFeed` (cursor
load-more through the public API), `Gallery`, `ContactCard`,
`MobileNav`, `ListingImage` (error fallback). No state library:
**URL search params are the durable search state**.

## Design tokens

`src/app/globals.css` `@theme` is the single source: primary #2563EB,
navy #0F172A, surface #F8FAFC, muted #64748B, line #E2E8F0, Inter,
breakpoints md=768 / lg=1200 / xl=1440, content 1320px, 4:3 imagery
(`.aspect-vehicle`), 48px minimum targets (`min-h-12`), global
`:focus-visible` ring.

## URL filter model

Parameter names are **exactly** the Phase 4.8 API names (`category`,
`brand_id`, `model_id`, `city_id`, `price_min/max`, `year_min/max`,
`mileage_max`, the six `*_id` option filters, `credit`, `barter`,
`feature_ids`, `sort`). `src/lib/marketplace/search-params.ts`
parses only known keys, serializes deterministically (default sort
omitted), and drops incompatible filters on category change. Invalid
URL state → safe "Axtarış parametrləri düzgün deyil" state with a
clear-filters action; zero results → "Uyğun elan tapılmadı" (never an
error). Filters apply explicitly ("Tətbiq et"); sort changes reset
any loaded pages (the results component is keyed by the query
string).

## Responsive filters

Desktop (≥1200): persistent left sidebar. Tablet/mobile: "Filterlər
(n)" button opening a native `<dialog>` drawer (browser-managed focus
trap, Esc closes, backdrop). Category-specific controls come from
`visibleFilterGroups()` (MOTORCYCLE_TYPE only for motorcycles;
BODY_TYPE/DRIVE_TYPE only for cars) — mirrored by backend validation
but decided in the UI.

## Cards, Boost, Premium, paging

One `ListingCard` (public DTO only; 4:3 image with local CSS/SVG
placeholder for `null`/failed URLs; brand/model/year, price, mileage,
city, badges, freshness; links to `/elan/{publicId}`). Boost: the
API's ≤4 promoted cards render above organic results on page 1 with
viewport visibility 2 / 3 / 4 (`boostSlotClass`), labeled "Reklam";
the backend already guarantees no organic duplicate. Premium: first
24 server-rendered, "Daha çox göstər" appends via `next_cursor` /
`has_more` — no inventory cap, nothing loaded eagerly. Search uses the
same explicit load-more (simpler and back-button-safe than infinite
scroll). Loaded extra pages live only in memory: Back returns to page 1
with all URL filters intact (documented MVP behavior).

## Listing detail states

| API status | Rendering |
| --- | --- |
| ACTIVE (contactable) | gallery, title, price, specs, description (text only), features, `ContactCard` |
| SOLD / EXPIRED | status badge + notice, limited summary, primary image only, no contact, `noindex` |
| anything else / unknown / UUID | generic 404 page, no state wording |

Contactability is decided by the backend response only (never client
time).

## Contact action

The detail DTO carries only a masked phone, so the accepted CTA
required the allowed focused endpoint `POST
/api/v1/listings/:publicId/contact`: anonymous, listing must be
publicly visible, source is **`listing.contact_phone_e164` only**
(never the account phone; `null` → `LISTING_CONTACT_UNAVAILABLE`),
aggregate `phone_reveal_count` incremented best-effort, `no-store`.
The UI reveals on explicit click, then offers `tel:` and a WhatsApp
deep link built client-side from the revealed digits only; no
server-side messaging. **Deferred**: per-IP/per-listing reveal rate
limiting (no compatible infrastructure without a new table) —
platform/WAF controls apply meanwhile.

## Images & gallery

Signed URLs from the API are used verbatim (never rebuilt). Cards load
lazily except above-the-fold; the detail primary image is eager/high
priority. Gallery: desktop large image + thumbnails, mobile
scroll-snap strip with counter — no carousel dependency.

## SEO & accessibility

`generateMetadata` per route (detail: "Brand Model Year — AVTOSH.AZ",
description, canonical `/elan/{publicId}`, OpenGraph image, `noindex`
for SOLD/EXPIRED). Semantic landmarks (`header/nav/main/section/
article`), heading hierarchy, skip link, labeled controls, visible
focus, 48px targets, `role="radiogroup"` category toggle,
`aria-current` thumbnails, text-based status badges, `aria-live`
gallery counter, `<dialog>` drawers.

## Caching & performance

No frontend cache layer; pages are `force-dynamic` and respect the
Phase 4.8 expiry-bounded `Cache-Control` on the APIs used by
load-more. Catalog data for filters is fetched once per render on the
server; dependent models fetch on demand. Only the interactive
islands ship client JS.

## Testing

Unit: formatters, URL filter model, filter visibility, Boost slots,
cursor append dedup. E2E (Playwright, desktop/tablet/mobile projects):
the webServer boots the accepted ephemeral-Postgres harness + a
deterministic seed (`scripts/e2e/seed.mjs`), so Home/Search/Detail/
responsive specs run against real data with null image URLs (no
Supabase), exercising the placeholder path. CI runs E2E as a separate
job.

## Open checkpoints

Contact reveal rate limiting; real Supabase image delivery/CDN;
production catalog data; seller/auth/favorites UIs (later phases);
header auth-aware state once the auth UI phase lands.
