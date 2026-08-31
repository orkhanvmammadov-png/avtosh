import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { UI } from "@/lib/marketplace/labels";

/**
 * Global 404 — used by every surface (public pages and the staff
 * portals' non-disclosure 404s), so it renders standalone with its
 * own minimal brand chrome instead of any shell.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-line bg-raised">
        <div className="mx-auto flex h-16 max-w-(--container-content) items-center px-4">
          <Link href="/" className="text-xl font-extrabold tracking-tight text-primary">
            {UI.brand}
          </Link>
        </div>
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4">
        <section className="py-24 text-center" aria-labelledby="nf-title">
          <p className="text-6xl font-extrabold tracking-tight text-line-strong">404</p>
          <h1 id="nf-title" className="mt-4 text-2xl font-bold text-navy">{UI.notFoundTitle}</h1>
          <p className="mt-2 text-sm text-muted">{UI.notFoundHint}</p>
          <Link href="/" className={buttonClasses("primary", "mt-8")}>{UI.backHome}</Link>
        </section>
      </main>
    </div>
  );
}
