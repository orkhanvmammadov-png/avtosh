import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

/**
 * Approved button contract (components.md): Fira Sans 600 +1% LS,
 * radius 6 (staff compact 4), sizes lg h48 / md h40 / staff h32;
 * touch targets stay ≥48px below md. Variants incl. Premium
 * (navy+gold) and Boost (green tint + ink) per spec.
 */
const VARIANTS = {
  primary: "bg-primary text-white hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-40",
  secondary:
    "bg-raised text-ink border border-line-strong hover:border-primary hover:text-primary active:bg-primary-tint active:text-primary-pressed disabled:opacity-60",
  ghost: "bg-transparent text-primary hover:bg-primary-tint active:bg-primary-tint-pressed disabled:opacity-60",
  danger: "bg-danger text-white hover:bg-danger-hover active:bg-danger-pressed disabled:opacity-40",
  premium: "bg-navy text-premium hover:bg-navy-raised active:bg-[#0D1219] disabled:opacity-40",
  boost: "bg-boost-soft text-boost hover:bg-primary-tint-pressed active:bg-[#C7E2D3] disabled:opacity-50",
} as const;

const SIZES = {
  /** staff compact — desktop staff tables only (never touch surfaces) */
  sm: "h-8 rounded-staff px-3 text-xs",
  /** standard */
  md: "min-h-10 rounded-control px-4 text-[13.5px] max-md:min-h-12",
  /** large CTA */
  lg: "min-h-12 rounded-control px-5 text-sm",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export function buttonClasses(variant: ButtonVariant = "primary", extra = "", size: ButtonSize = "md"): string {
  return `inline-flex items-center justify-center gap-2 font-semibold tracking-[0.01em] transition-colors duration-150 disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  type = "button",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, className, size)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
