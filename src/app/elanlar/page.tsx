import type { Metadata } from "next";
import Link from "next/link";
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
  return { categories, brands, models, cities, options, features };
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
    <div className="py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">{categoryLabel} {UI.listings.toLowerCase()}</h1>
        <SortSelect />
      </div>
      <div className="flex flex-col gap-6 lg:flex-row">
        <SearchFilters state={state} catalog={catalog} activeCount={activeCount} />
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
    </div>
  );
}
