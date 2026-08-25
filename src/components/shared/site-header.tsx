import Link from "next/link";
import { MobileNav } from "@/components/shared/mobile-nav";
import { buttonClasses } from "@/components/ui/button";
import { UI } from "@/lib/marketplace/labels";

/** Public header. Auth-aware presentation is a later phase; anonymous browsing is complete. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-(--container-content) items-center justify-between gap-4 px-4">
        <Link href="/" className="text-xl font-extrabold tracking-tight text-primary" aria-label={`${UI.brand} — ana səhifə`}>
          {UI.brand}
        </Link>
        <nav aria-label="Əsas naviqasiya" className="hidden items-center gap-1 md:flex">
          <Link href="/elanlar?category=CAR" className="rounded-lg px-3 py-3 text-sm font-medium text-navy hover:bg-surface">
            {UI.cars}
          </Link>
          <Link href="/elanlar?category=MOTORCYCLE" className="rounded-lg px-3 py-3 text-sm font-medium text-navy hover:bg-surface">
            {UI.motorcycles}
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/daxil-ol" className="hidden rounded-lg px-3 py-3 text-sm font-medium text-navy hover:bg-surface md:inline-flex">
            {UI.login}
          </Link>
          <Link href="/elan-yerlesdir" className={buttonClasses("primary", "hidden md:inline-flex")}>
            {UI.postListing}
          </Link>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
