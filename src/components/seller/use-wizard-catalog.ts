"use client";

import { useEffect, useMemo, useState } from "react";
import { publicFetch } from "@/lib/marketplace/public-api";

export interface CatalogItem {
  id: string;
  name: string;
  code?: string;
}

export const OPTION_GROUPS = [
  { group: "FUEL_TYPE", field: "fuel_type_id" as const, dtoKey: "fuelTypeId" as const, label: "Yanacaq növü" },
  { group: "TRANSMISSION", field: "transmission_id" as const, dtoKey: "transmissionId" as const, label: "Sürətlər qutusu" },
  { group: "BODY_TYPE", field: "body_type_id" as const, dtoKey: "bodyTypeId" as const, label: "Ban növü" },
  { group: "DRIVE_TYPE", field: "drive_type_id" as const, dtoKey: "driveTypeId" as const, label: "Ötürücü" },
  { group: "MOTORCYCLE_TYPE", field: "motorcycle_type_id" as const, dtoKey: "motorcycleTypeId" as const, label: "Motosiklet növü" },
  { group: "COLOR", field: "color_id" as const, dtoKey: "colorId" as const, label: "Rəng" },
];

async function list(url: string): Promise<CatalogItem[]> {
  try {
    return (await publicFetch<CatalogItem[]>(url)).data;
  } catch {
    return [];
  }
}

/**
 * Catalog data for the wizard, driven by the SERVER's current
 * category/brand values — when a PATCH response clears brand/model,
 * dependent lists follow automatically. Option groups are data-driven:
 * a group that returns no options for the category simply isn't
 * rendered (the server already scopes options per category).
 */
export function useWizardCatalog(category: string, brandId: string | null) {
  const [categories, setCategories] = useState<CatalogItem[]>([]);
  const [brands, setBrands] = useState<CatalogItem[]>([]);
  const [models, setModels] = useState<CatalogItem[]>([]);
  const [cities, setCities] = useState<CatalogItem[]>([]);
  const [options, setOptions] = useState<Record<string, CatalogItem[]>>({});
  const [features, setFeatures] = useState<CatalogItem[]>([]);

  useEffect(() => {
    void list("/api/v1/catalog/categories").then(setCategories);
    void list("/api/v1/catalog/cities").then(setCities);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const c = encodeURIComponent(category);
    void list(`/api/v1/catalog/brands?category=${c}`).then((r) => {
      if (!cancelled) setBrands(r);
    });
    void list(`/api/v1/catalog/features?category=${c}`).then((r) => {
      if (!cancelled) setFeatures(r);
    });
    void Promise.all(
      OPTION_GROUPS.map(async (g) => [g.group, await list(`/api/v1/catalog/options?group=${g.group}&category=${c}`)] as const),
    ).then((entries) => {
      if (!cancelled) setOptions(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [category]);

  useEffect(() => {
    let cancelled = false;
    const fetchModels =
      brandId === null
        ? Promise.resolve<CatalogItem[]>([])
        : list(`/api/v1/catalog/models?category=${encodeURIComponent(category)}&brand_id=${brandId}`);
    void fetchModels.then((r) => {
      if (!cancelled) setModels(r);
    });
    return () => {
      cancelled = true;
    };
  }, [category, brandId]);

  const nameOf = useMemo(() => {
    const all = new Map<string, string>();
    for (const item of [...categories, ...brands, ...models, ...cities, ...features, ...Object.values(options).flat()]) {
      all.set(item.id, item.name);
    }
    return (id: string | null): string | null => (id === null ? null : (all.get(id) ?? null));
  }, [categories, brands, models, cities, features, options]);

  return { categories, brands, models, cities, options, features, nameOf };
}

export type WizardCatalog = ReturnType<typeof useWizardCatalog>;
