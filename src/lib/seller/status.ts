/** Seller-facing status presentation — raw enums never reach the UI. */

export type OwnerAction =
  | { kind: "wizard"; label: string }
  | { kind: "public"; label: string }
  | { kind: "renew"; label: string }
  | { kind: "none" };

export interface StatusPresentation {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  action: OwnerAction;
}

export const STATUS_PRESENTATION: Record<string, StatusPresentation> = {
  DRAFT: { label: "Qaralama", tone: "neutral", action: { kind: "wizard", label: "Davam et" } },
  PAYMENT_REQUIRED: { label: "Ödəniş tələb olunur", tone: "warning", action: { kind: "wizard", label: "Ətraflı" } },
  PAYMENT_COMPLETED: { label: "Ödəniş tamamlanıb", tone: "info", action: { kind: "none" } },
  PENDING_MODERATION: { label: "Moderasiyadadır", tone: "info", action: { kind: "wizard", label: "Ətraflı" } },
  CORRECTION_REQUIRED: { label: "Düzəliş tələb olunur", tone: "warning", action: { kind: "wizard", label: "Düzəliş et" } },
  REJECTED: { label: "Rədd edilib", tone: "danger", action: { kind: "wizard", label: "Redaktə et" } },
  ACTIVE: { label: "Aktiv", tone: "success", action: { kind: "public", label: "Elana bax" } },
  SUSPENDED: { label: "Dayandırılıb", tone: "danger", action: { kind: "none" } },
  SOLD: { label: "Satılıb", tone: "neutral", action: { kind: "public", label: "Elana bax" } },
  EXPIRED: { label: "Müddəti bitib", tone: "warning", action: { kind: "renew", label: "Yenilə" } },
};

export function statusPresentation(status: string): StatusPresentation {
  return (
    STATUS_PRESENTATION[status] ?? { label: "Elan", tone: "neutral", action: { kind: "none" } }
  );
}

/** Controlled moderation reason codes → seller-readable Azerbaijani. */
export const REASON_LABELS: Record<string, string> = {
  INVALID_PHOTOS: "Şəkillər uyğun deyil",
  MISLEADING_INFO: "Yanlış və ya aldadıcı məlumat",
  WRONG_CATEGORY: "Yanlış kateqoriya",
  DUPLICATE_LISTING: "Təkrar elan",
  PROHIBITED_ITEM: "Qadağan olunmuş məhsul",
  INCOMPLETE_INFO: "Natamam məlumat",
  SUSPICIOUS_PRICE: "Şübhəli qiymət",
  CONTACT_ISSUE: "Əlaqə nömrəsi problemi",
  OTHER: "Digər səbəb",
};

/** Submission completeness codes (details.missing) → field labels. */
export const MISSING_FIELD_LABELS: Record<string, string> = {
  brand: "Marka",
  model: "Model",
  year: "Buraxılış ili",
  price: "Qiymət",
  mileage: "Yürüş",
  city: "Şəhər",
  contact_phone: "Əlaqə nömrəsi",
};
