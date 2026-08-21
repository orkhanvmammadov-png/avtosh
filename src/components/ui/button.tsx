import type { ButtonHTMLAttributes } from "react";

const VARIANTS = {
  primary: "bg-primary text-white hover:bg-primary-hover disabled:bg-primary/50",
  secondary: "bg-white text-navy border border-line hover:bg-surface disabled:text-muted",
  ghost: "bg-transparent text-navy hover:bg-line/60 disabled:text-muted",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

/** 48px minimum touch target, visible focus via global :focus-visible. */
export function buttonClasses(variant: ButtonVariant = "primary", extra = ""): string {
  return `inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClasses(variant, className)} {...props} />;
}
