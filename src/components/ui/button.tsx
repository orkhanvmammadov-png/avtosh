import type { ButtonHTMLAttributes } from "react";

const VARIANTS = {
  primary: "bg-primary text-white hover:bg-primary-hover disabled:bg-primary/50",
  secondary: "bg-raised text-navy border border-line hover:bg-surface hover:border-line-strong disabled:text-muted",
  ghost: "bg-transparent text-navy hover:bg-line/60 disabled:text-muted",
  danger: "bg-danger text-white hover:bg-danger-deep disabled:bg-danger/50",
} as const;

const SIZES = {
  /* sm is for DENSE STAFF DESKTOP rows only — touch surfaces keep ≥48px. */
  sm: "min-h-10 px-3 text-sm",
  md: "min-h-12 px-4 text-sm",
  lg: "min-h-14 px-6 text-base",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

/** 48px minimum touch target (md), visible focus via global :focus-visible. */
export function buttonClasses(variant: ButtonVariant = "primary", extra = "", size: ButtonSize = "md"): string {
  return `inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${extra}`;
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
      {loading ? (
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" className="opacity-25" />
          <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
        </svg>
      ) : null}
      {children}
    </button>
  );
}
