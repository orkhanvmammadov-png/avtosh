import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import Link from "next/link";
import { AppliedFilters } from "@/components/marketplace/applied-filters";
import { BackToTop } from "@/components/marketplace/back-to-top";
import { FiltersTrigger } from "@/components/marketplace/filters-trigger";
import { SearchFilters, type FilterCatalog } from "@/components/marketplace/search-filters";
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
  // Authoritative year options, newest first (server-computed — one
  // consistent list through SSR and hydration).
  const yearMax = listingYearMax();
  const years = Array.from({ length: yearMax - LISTING_YEAR_MIN + 1 }, (_, i) => yearMax - i);
  return { categories, years, brands, models, cities, options, features };
}

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
  const activeCount = Object.keys(state).filter((k) => !["category", "sort"].includes(k)).length;
  const categoryLabel = CATEGORY_LABELS[state.category] ?? UI.listings;
  const clearHref = searchHref({ category: state.category });

  return (
    <Container>
    <div className="py-6">
      <h1 className="text-xl font-bold tracking-[-0.01em] text-ink md:text-2xl">
        {categoryLabel} {UI.listings.toLowerCase()}
      </h1>
      <div className="mt-3 empty:hidden">
        <AppliedFilters state={state} catalog={catalog} />
      </div>
      {/* Results toolbar: sticky under the header until the rail appears at desk (1024). */}
      <div className="sticky top-14 z-30 -mx-4 mt-3 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur desk:static desk:mx-0 desk:justify-end desk:border-0 desk:bg-transparent desk:p-0">
        <FiltersTrigger activeCount={activeCount} />
        <SortSelect />
      </div>
      <div className="mt-4 flex flex-col gap-6 desk:flex-row">
        <SearchFilters state={state} catalog={catalog} />
        <section aria-label="Axtarış nəticələri" className="min-w-0 flex-1">
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
              key={filtersToQueryString(state)}
              queryString={filtersToQueryString(state)}
              promoted={result.promoted}
              initialItems={result.items}
              initialCursor={result.nextCursor}
              initialHasMore={result.hasMore}
              renderedAtMs={result.generatedAtMs}
            />
          ) : null}
        </section>
      </div>
      <BackToTop />
    </div>
  </Container>
  );
}
