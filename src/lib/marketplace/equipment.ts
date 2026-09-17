/**
 * O.11 equipment grouping + search helpers, shared by the seller
 * selector (Stage B) and later the public Listing Detail grouping
 * (Stage C). The database stores only stable group CODES; the
 * Azerbaijani labels live here, in the established frontend
 * localization pattern (labels.ts-style constants, no i18n framework).
 */

export interface EquipmentItem {
  name: string;
  group?: string | null;
}

/** Approved seven CAR groups — display order EXACTLY as listed (never
    alphabetized). */
export const EQUIPMENT_GROUPS: readonly { code: string; label: string }[] = [
  { code: "SAFETY", label: "Təhlükəsizlik" },
  { code: "DRIVER_ASSISTANCE", label: "Sürücü köməkçiləri" },
  { code: "PARKING_CAMERA", label: "Park və kameralar" },
  { code: "COMFORT", label: "Komfort" },
  { code: "CLIMATE_INTERIOR", label: "Klimat və interyer" },
  { code: "MULTIMEDIA", label: "Multimedia və texnologiya" },
  { code: "LIGHTING_EXTERIOR", label: "İşıq və eksteryer" },
];

/** Fallback bucket for null/unknown group codes (legacy data only —
    the normal CAR O.11 catalog never produces it). Always rendered
    LAST and only when such items exist. */
export const EQUIPMENT_FALLBACK_GROUP = { code: "OTHER_FALLBACK", label: "Digər" } as const;

export interface EquipmentGroupView<T extends EquipmentItem> {
  code: string;
  label: string;
  items: T[];
}

/**
 * Buckets catalog/selected items into the approved ordered groups.
 * Groups without items are omitted (MOTO's ABS-only catalog therefore
 * renders a single Təhlükəsizlik group); null/unknown codes fall into
 * a trailing Digər bucket without disturbing the approved order.
 */
export function groupEquipment<T extends EquipmentItem>(items: T[]): EquipmentGroupView<T>[] {
  const known = new Map<string, T[]>(EQUIPMENT_GROUPS.map((g) => [g.code, []]));
  const fallback: T[] = [];
  for (const item of items) {
    const bucket = item.group == null ? undefined : known.get(item.group);
    if (bucket === undefined) {
      fallback.push(item);
    } else {
      bucket.push(item);
    }
  }
  const groups: EquipmentGroupView<T>[] = [];
  for (const g of EQUIPMENT_GROUPS) {
    const bucketed = known.get(g.code)!;
    if (bucketed.length > 0) groups.push({ code: g.code, label: g.label, items: bucketed });
  }
  if (fallback.length > 0) {
    groups.push({ code: EQUIPMENT_FALLBACK_GROUP.code, label: EQUIPMENT_FALLBACK_GROUP.label, items: fallback });
  }
  return groups;
}

/** ASCII folding for Azerbaijani letters, so common ASCII typing finds
    AZ labels ("gorüntu" → "görüntü", "tehlukesizlik" → "təhlükəsizlik"). */
const AZ_FOLD: Record<string, string> = {
  ə: "e",
  ı: "i",
  ö: "o",
  ü: "u",
  ş: "s",
  ç: "c",
  ğ: "g",
};

/**
 * Deterministic AZ-friendly normalization: az-locale lowercase (İ→i,
 * I→ı handled by the locale), trim, whitespace collapse, combining
 * marks stripped, and Azerbaijani-letter folding onto ASCII.
 * Matching compares normalize(label).includes(normalize(query)).
 */
export function normalizeEquipmentText(text: string): string {
  return text
    .toLocaleLowerCase("az")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[əıöüşçğ]/g, (ch) => AZ_FOLD[ch] ?? ch);
}

/** Case/diacritic-insensitive equipment label match. Empty queries
    match nothing (search inactive). */
export function equipmentMatches(label: string, query: string): boolean {
  const q = normalizeEquipmentText(query);
  if (q === "") return false;
  return normalizeEquipmentText(label).includes(q);
}

/**
 * Applies an ordered log of selection intents (id → desired checked
 * state) onto a base UUID list. Because every entry carries the FULL
 * intent since the last settle, the result is correct even when
 * `base` is a stale in-flight server snapshot — this is what makes
 * rapid multi-select lose nothing. Deduplicated; base order kept,
 * additions appended in intent order.
 */
export function applySelectionOps(base: readonly string[], ops: Iterable<readonly [string, boolean]>): string[] {
  const set = new Set(base);
  for (const [id, want] of ops) {
    if (want) {
      set.add(id);
    } else {
      set.delete(id);
    }
  }
  return [...set];
}
