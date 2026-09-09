import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import Link from "next/link";
import { AppliedFilters, type FilterCatalog } from "@/components/marketplace/applied-filters";
import { BackToTop } from "@/components/marketplace/back-to-top";
import { HomeSearch } from "@/components/marketplace/home-search";
import { SearchResults } from "@/components/marketplace/search-results";
import { SortSelect } from "@/components/marketplace/sort-select";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiError } from "@/lib/api/errors";
import { CATEGORY_LABELS, UI } from "@/lib/marketplace/labels";
import {
  filtersFromSearchParams,
  filtersToQueryString,
  searchHref,
  visibleFilterGroups,
  type SearchFilterState,
} from "@/lib/marketplace/search-params";
import { getBrands, getCategories, getCities, getFeatures, getModels, getReferenceOptions } from "@/services/catalog";
import { loadAdvancedCatalog } from "@/services/advanced-catalog";
import { LISTING_YEAR_MIN, listingYearMax } from "@/lib/config/marketplace";
import { searchMarketplace, type SearchResultDto } from "@/services/marketplace";
import { searchQuerySchema } from "@/validators/marketplace";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const state = filtersFromSearchParams(await searchParams);
  const label = CATEGORY_LABELS[state.category ?? ""] ?? UI.listings;
  return { title: `${label} elanları`, alternates: { canonical: searchHref(state) } };
}

/** Catalog rows for the applied-filter chip labels (unchanged model). */
async function loadCatalog(state: SearchFilterState): Promise<FilterCatalog> {
  const category = state.category ?? "CAR";
  const [categories, brands, cities, features, ...groups] = await Promise.all([
    getCategories(),
    getBrands(category).catch(() => []),
    getCities(),
    getFeatures(category).catch(() => []),
    ...visibleFilterGroups(category).map((g) => getReferenceOptions(g, category).catch(() => [])),
  ]);
  const options: FilterCatalog["options"] = {};
  visibleFilterGroups(category).forEach((g, i) => { options[g] = groups[i]; });
  const models = state.brand_id ? await getModels(category, state.brand_id).catch(() => []) : [];
  const yearMax = listingYearMax();
  const years = Array.from({ length: yearMax - LISTING_YEAR_MIN + 1 }, (_, i) => yearMax - i);
  return { categories, years, brands, models, cities, options, features };
}

/**
 * O.6 unified Search Results: the approved Home / Direction-1C search
 * card (results mode, restored from the URL) on top, chips + Sort
 * toolbar, then ONE full-width boost-first results grid. No sidebar,
 * no separate Reklam section. All search/URL/boost semantics are the
 * existing ones — this page only recomposes presentation.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const state = filtersFromSearchParams(raw);
  if (state.category === undefined) {
    state.category = "CAR"; // default marketplace context; URL stays canonical via links
  }
  const parsed = searchQuerySchema.safeParse(state);

  let result: SearchResultDto | null = null;
  let errorCode: string | null = parsed.success ? null : "VALIDATION_ERROR";
  if (parsed.success) {
    try {
      result = await searchMarketplace(parsed.data);
    } catch (error) {
      errorCode = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
    }
  }
  const catalog = await loadCatalog(state);
  const advanced = await loadAdvancedCatalog(catalog.categories.map((c) => c.code));
  const categoryLabel = CATEGORY_LABELS[state.category] ?? UI.listings;
  const clearHref = searchHref({ category: state.category });
  const queryString = filtersToQueryString(state);

  return (
    <Container>
      <div className="py-5 md:py-6">
        <h1 className="sr-only">{`${categoryLabel} ${UI.listings.toLowerCase()}`}</h1>
        {/* Unified search card — remounted per query string so URL
            navigation (apply, chips, clear, sort, Back/Forward) always
            re-initializes the controls from the parsed URL. */}
        <HomeSearch
          key={queryString}
          mode="results"
          initialState={state}
          initialModels={catalog.models}
          categories={catalog.categories}
          initialBrands={catalog.brands}
          advanced={advanced}
        />
        {/* Toolbar: active filter chips (left, wrapping) + Sort (right). */}
        <div className="mb-4 mt-3.5 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 empty:hidden">
            <AppliedFilters state={state} catalog={catalog} />
          </div>
          <SortSelect />
        </div>
        <section aria-label="Axtarış nəticələri" className="min-w-0">
          {errorCode !== null ? (
            <EmptyState
              title={errorCode === "INTERNAL_ERROR" ? UI.errorTitle : UI.invalidFilters}
              hint={errorCode === "INTERNAL_ERROR" ? UI.errorHint : UI.noResultsHint}
              action={<Link href={clearHref} className={buttonClasses("primary")} data-testid="error-clear">{UI.clearFilters}</Link>}
            />
          ) : result !== null && result.items.length === 0 && result.promoted.length === 0 ? (
            <EmptyState
              title={UI.noResults}
              hint={UI.noResultsHint}
              action={<Link href={clearHref} className={buttonClasses("primary")} data-testid="empty-clear">{UI.clearFilters}</Link>}
            />
          ) : result !== null ? (
            <SearchResults
              key={queryString}
              queryString={queryString}
              promoted={result.promoted}
              initialItems={result.items}
              initialCursor={result.nextCursor}
              initialHasMore={result.hasMore}
              renderedAtMs={result.generatedAtMs}
            />
          ) : null}
        </section>
        <BackToTop />
      </div>
    </Container>
  );
}
