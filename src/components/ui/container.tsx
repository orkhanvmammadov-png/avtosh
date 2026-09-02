import type { HTMLAttributes, ReactNode } from "react";

/**
 * Approved content container: max 1360, centered, responsive gutters
 * 16/24/32/40 (tokens.md). Pages own their containers so navy stages
 * (hero, detail, footer) can run genuinely full-bleed — no viewport
 * hacks, no body overflow masking.
 */
export function Container({
  children,
  className = "",
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`mx-auto w-full max-w-(--container-content) px-4 md:px-6 desk:px-8 xl:px-10 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
