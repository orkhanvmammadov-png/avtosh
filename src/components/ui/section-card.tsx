import type { HTMLAttributes, ReactNode } from "react";

/** The standard raised content card (page sections, detail blocks). */
export function SectionCard({
  title,
  titleId,
  children,
  className = "",
  ...rest
}: {
  title?: ReactNode;
  titleId?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section
      aria-labelledby={titleId}
      className={`rounded-card border border-line bg-raised p-4 shadow-card md:p-6 ${className}`}
      {...rest}
    >
      {title !== undefined ? (
        <h2 id={titleId} className="text-lg font-semibold text-navy">
          {title}
        </h2>
      ) : null}
      {title !== undefined ? <div className="mt-3">{children}</div> : children}
    </section>
  );
}
