import type { SearchSort } from "@/lib/config/marketplace";

/** Buyer-visible Azerbaijani labels (single place — no English in UI). */
export const CATEGORY_LABELS: Record<string, string> = {
  CAR: "Avtomobil",
  MOTORCYCLE: "Motosiklet",
};

export const SORT_LABELS: Record<SearchSort, string> = {
  NEWEST: "Ən yeni",
  PRICE_ASC: "Qiymət: artan",
  PRICE_DESC: "Qiymət: azalan",
  YEAR_DESC: "İl: yenidən köhnəyə",
};

export const STATUS_LABELS = {
  SOLD: "Satılıb",
  EXPIRED: "Müddəti bitib",
} as const;

export const UI = {
  brand: "AVTOSH.AZ",
  listings: "Elanlar",
  cars: "Avtomobillər",
  motorcycles: "Motosikletlər",
  postListing: "Elan yerləşdir",
  login: "Daxil ol",
  search: "Axtar",
  brandLabel: "Marka",
  modelLabel: "Model",
  city: "Şəhər",
  price: "Qiymət",
  year: "Buraxılış ili",
  mileage: "Yürüş",
  showMore: "Daha çox göstər",
  clearFilters: "Filterləri təmizlə",
  applyFilters: "Tətbiq et",
  filters: "Filterlər",
  sort: "Sıralama",
  premium: "Premium elanlar",
  promoted: "Reklam",
  premiumBadge: "Premium",
  boostedBadge: "Reklam",
  loading: "Yüklənir…",
  noResults: "Uyğun elan tapılmadı",
  noResultsHint: "Filterləri dəyişin və ya təmizləyin.",
  errorTitle: "Xəta baş verdi",
  errorHint: "Zəhmət olmasa bir az sonra yenidən cəhd edin.",
  invalidFilters: "Axtarış parametrləri düzgün deyil",
  notFoundTitle: "Elan tapılmadı",
  notFoundHint: "Bu elan mövcud deyil və ya artıq göstərilmir.",
  backHome: "Ana səhifəyə qayıt",
  showPhone: "Nömrəni göstər",
  callSeller: "Zəng et",
  whatsapp: "WhatsApp ilə yaz",
  contactUnavailable: "Əlaqə məlumatı mövcud deyil",
  contactRateLimited: "Çox sayda cəhd edildi. Bir az sonra yenidən yoxlayın.",
  seller: "Satıcı",
  description: "Təsvir",
  features: "Təchizat",
  specs: "Xüsusiyyətlər",
  any: "Hamısı",
  min: "min",
  max: "maks",
  credit: "Kredit",
  barter: "Barter",
  imageUnavailable: "Şəkil yoxdur",
  photoOf: "Şəkil",
} as const;

export const SPEC_LABELS = {
  fuelType: "Yanacaq",
  transmission: "Sürətlər qutusu",
  bodyType: "Ban növü",
  driveType: "Ötürücü",
  motorcycleType: "Motosiklet növü",
  color: "Rəng",
  engineCc: "Mühərrik",
  mileage: "Yürüş",
  year: "Buraxılış ili",
  city: "Şəhər",
  credit: "Kredit",
  barter: "Barter",
} as const;

export const GROUP_LABELS: Record<string, string> = {
  FUEL_TYPE: "Yanacaq",
  TRANSMISSION: "Sürətlər qutusu",
  BODY_TYPE: "Ban növü",
  DRIVE_TYPE: "Ötürücü",
  MOTORCYCLE_TYPE: "Motosiklet növü",
  COLOR: "Rəng",
};
