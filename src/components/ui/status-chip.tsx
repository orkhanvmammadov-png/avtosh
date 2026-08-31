import type { ReactNode } from "react";

/**
 * The one status chip. Soft background + deep foreground + hairline
 * border per tone — never color-only (the label carries the meaning).
 * Central maps translate business enums to Azerbaijani labels; staff
 * surfaces may show the internal code as secondary context via
 * `code`, never as the unstyled primary label.
 */

const TONES = {
  neutral: "bg-sunken text-slate-strong border-line",
  info: "bg-info-soft text-info-deep border-info-line",
  success: "bg-success-soft text-success-deep border-success-line",
  warning: "bg-warning-soft text-warning-deep border-warning-line",
  danger: "bg-danger-soft text-danger-deep border-danger-line",
  premium: "bg-premium-soft text-premium-deep border-premium-line",
  boost: "bg-boost-soft text-boost-deep border-boost-line",
} as const;

export type ChipTone = keyof typeof TONES;

export function StatusChip({
  tone = "neutral",
  children,
  code,
  className = "",
  ...rest
}: {
  tone?: ChipTone;
  children: ReactNode;
  /** Optional internal code shown as secondary context (staff surfaces). */
  code?: string;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ${TONES[tone]} ${className}`}
      {...rest}
    >
      {children}
      {code !== undefined ? <span className="font-mono text-[10px] font-normal opacity-70">{code}</span> : null}
    </span>
  );
}

export interface ChipSpec {
  label: string;
  tone: ChipTone;
}

/** Listing statuses — seller/staff wording (public pages use badges). */
export const LISTING_STATUS_CHIPS: Record<string, ChipSpec> = {
  DRAFT: { label: "Qaralama", tone: "neutral" },
  PAYMENT_REQUIRED: { label: "Ödəniş tələb olunur", tone: "warning" },
  PAYMENT_COMPLETED: { label: "Ödəniş tamamlanıb", tone: "info" },
  PENDING_MODERATION: { label: "Moderasiyadadır", tone: "info" },
  CORRECTION_REQUIRED: { label: "Düzəliş tələb olunur", tone: "warning" },
  REJECTED: { label: "Rədd edilib", tone: "danger" },
  ACTIVE: { label: "Aktiv", tone: "success" },
  SUSPENDED: { label: "Dayandırılıb", tone: "danger" },
  SOLD: { label: "Satılıb", tone: "neutral" },
  EXPIRED: { label: "Müddəti bitib", tone: "warning" },
  DELETED: { label: "Silinib", tone: "neutral" },
};

export const PAYMENT_STATUS_CHIPS: Record<string, ChipSpec> = {
  CREATED: { label: "Yaradılıb", tone: "neutral" },
  PENDING: { label: "Gözləyir", tone: "warning" },
  SUCCESS: { label: "Uğurlu", tone: "success" },
  FAILED: { label: "Uğursuz", tone: "danger" },
  CANCELLED: { label: "Ləğv edilib", tone: "neutral" },
  REFUNDED: { label: "Geri qaytarılıb", tone: "info" },
};

export const PROMOTION_STATUS_CHIPS: Record<string, ChipSpec> = {
  SCHEDULED: { label: "Növbədə", tone: "info" },
  ACTIVE: { label: "Aktiv", tone: "success" },
  EXPIRED: { label: "Bitib", tone: "neutral" },
  CANCELLED: { label: "Ləğv edilib", tone: "neutral" },
};

export const REPORT_STATUS_CHIPS: Record<string, ChipSpec> = {
  OPEN: { label: "Açıq", tone: "warning" },
  RESOLVED: { label: "Həll edilib", tone: "success" },
  DISMISSED: { label: "Əsassızdır", tone: "neutral" },
};

export function chipFor(map: Record<string, ChipSpec>, status: string): ChipSpec {
  return map[status] ?? { label: status, tone: "neutral" };
}
