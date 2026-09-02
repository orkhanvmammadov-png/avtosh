import type { ReactNode } from "react";

/**
 * Approved status chip (components.md): tint background + status
 * foreground + DOT (never color-only). Public/seller chips are pills
 * (r999); staff chips are r4 and may append the technical code in
 * mono. Enum VALUES never change — only display labels.
 */

const TONES = {
  neutral: "bg-sunken text-slate-strong",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  premium: "bg-navy text-premium",
  boost: "bg-boost-soft text-boost",
} as const;

export type ChipTone = keyof typeof TONES;

export function StatusChip({
  tone = "neutral",
  children,
  code,
  staff = false,
  className = "",
  ...rest
}: {
  tone?: ChipTone;
  children: ReactNode;
  /** Technical code as secondary context (staff surfaces only). */
  code?: string;
  /** Staff variant: radius 4 instead of pill. */
  staff?: boolean;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 text-xs font-semibold ${
        staff ? "rounded-staff" : "rounded-pill"
      } ${TONES[tone]} ${className}`}
      {...rest}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {children}
      {code !== undefined ? <span className="font-mono text-[10px] font-normal opacity-70">{code}</span> : null}
    </span>
  );
}

export interface ChipSpec {
  label: string;
  tone: ChipTone;
}

/** Listing statuses — approved AZ labels (components.md status map). */
export const LISTING_STATUS_CHIPS: Record<string, ChipSpec> = {
  DRAFT: { label: "Qaralama", tone: "neutral" },
  PAYMENT_REQUIRED: { label: "Ödəniş tələb olunur", tone: "warning" },
  PAYMENT_COMPLETED: { label: "Ödənilib", tone: "success" },
  PENDING_MODERATION: { label: "Yoxlanılır", tone: "warning" },
  CORRECTION_REQUIRED: { label: "Düzəliş tələb olunur", tone: "danger" },
  REJECTED: { label: "Rədd edildi", tone: "danger" },
  ACTIVE: { label: "Aktiv", tone: "success" },
  SUSPENDED: { label: "Dayandırılıb", tone: "danger" },
  SOLD: { label: "Satılıb", tone: "neutral" },
  EXPIRED: { label: "Müddəti bitib", tone: "neutral" },
  DELETED: { label: "Silinib", tone: "neutral" },
};

export const PAYMENT_STATUS_CHIPS: Record<string, ChipSpec> = {
  CREATED: { label: "Yaradılıb", tone: "neutral" },
  PENDING: { label: "Gözləyir", tone: "warning" },
  SUCCESS: { label: "Ödənildi", tone: "success" },
  FAILED: { label: "Uğursuz", tone: "danger" },
  CANCELLED: { label: "Ləğv edildi", tone: "neutral" },
  REFUNDED: { label: "Geri qaytarıldı", tone: "info" },
};

export const PROMOTION_STATUS_CHIPS: Record<string, ChipSpec> = {
  SCHEDULED: { label: "Növbədə", tone: "info" },
  ACTIVE: { label: "Aktiv", tone: "success" },
  EXPIRED: { label: "Bitib", tone: "neutral" },
  CANCELLED: { label: "Ləğv edildi", tone: "neutral" },
};

export const REPORT_STATUS_CHIPS: Record<string, ChipSpec> = {
  OPEN: { label: "Açıq", tone: "warning" },
  RESOLVED: { label: "Həll edildi", tone: "success" },
  DISMISSED: { label: "Bağlandı", tone: "neutral" },
};

export function chipFor(map: Record<string, ChipSpec>, status: string): ChipSpec {
  return map[status] ?? { label: status, tone: "neutral" };
}
