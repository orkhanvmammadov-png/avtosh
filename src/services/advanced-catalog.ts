import type { HomeAdvancedCatalog } from "@/components/marketplace/home-search";
import { LISTING_YEAR_MIN, listingYearMax } from "@/lib/config/marketplace";
import { visibleFilterGroups } from "@/lib/marketplace/search-params";
import { getCities, getReferenceOptions } from "@/services/catalog";

/**
 * Reference data for the unified search panel (O.2 Home, O.6 Results):
 * the same category-scoped catalog services the Search API uses —
 * loaded for every category so the client-side category switch needs
 * no extra requests. No new API. Years are server-computed for one
 * consistent SSR/hydration list.
 */
export async function loadAdvancedCatalog(categoryCodes: string[]): Promise<HomeAdvancedCatalog> {
  const cities = await getCities().catch(() => []);
  const yearMax = listingYearMax();
  const years = Array.from({ length: yearMax - LISTING_YEAR_MIN + 1 }, (_, i) => yearMax - i);
  const optionsByCategory: HomeAdvancedCatalog["optionsByCategory"] = {};
  await Promise.all(
    categoryCodes.map(async (category) => {
      const groups = visibleFilterGroups(category);
      const lists = await Promise.all(
        groups.map((g) => getReferenceOptions(g, category).catch(() => [])),
      );
      optionsByCategory[category] = {};
      groups.forEach((g, i) => { optionsByCategory[category][g] = lists[i]; });
    }),
  );
  return { cities, years, optionsByCategory };
}
