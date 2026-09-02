import type { HTMLAttributes, ReactNode } from "react";

/** Approved raised panel: white, radius 10 (staff 4), flat border. */
export function SectionCard({
  title,
  titleId,
  staff = false,
  children,
  className = "",
  ...rest
}: {
  title?: ReactNode;
  titleId?: string;
  staff?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section
      aria-labelledby={titleId}
      className={`border border-line bg-raised p-4 md:p-5 ${staff ? "rounded-staff" : "rounded-card"} ${className}`}
      {...rest}
    >
      {title !== undefined ? (
        <h2 id={titleId} className="text-base font-bold text-ink md:text-lg">
          {title}
        </h2>
      ) : null}
      {title !== undefined ? <div className="mt-3">{children}</div> : children}
    </section>
  );
}
