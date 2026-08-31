import Link from "next/link";
import { UI } from "@/lib/marketplace/labels";

/**
 * Public footer — only routes that actually exist; no placeholder
 * promises. Server-rendered (never hydrated), so the year is safe.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const link = "text-sm text-muted transition-colors hover:text-navy";
  return (
    <footer className="mt-16 border-t border-line bg-raised">
      <div className="mx-auto grid max-w-(--container-content) gap-8 px-4 py-10 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <p className="text-lg font-extrabold tracking-tight text-navy">
            AVTOSH<span className="text-primary">.AZ</span>
          </p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
            Azərbaycanda avtomobil və motosiklet elanları — yoxlanılmış elanlar, birbaşa əlaqə,
            təhlükəsiz onlayn ödəniş.
          </p>
        </div>
        <nav aria-label="Kateqoriyalar">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">Kateqoriyalar</p>
          <ul className="mt-3 space-y-2">
            <li><Link href="/elanlar?category=CAR" className={link}>{UI.cars}</Link></li>
            <li><Link href="/elanlar?category=MOTORCYCLE" className={link}>{UI.motorcycles}</Link></li>
          </ul>
        </nav>
        <nav aria-label="Hesab">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">Hesab</p>
          <ul className="mt-3 space-y-2">
            <li><Link href="/elan-yerlesdir" className={link}>{UI.postListing}</Link></li>
            <li><Link href="/profil/elanlar" className={link}>{UI.myListings}</Link></li>
            <li><Link href="/profil/secilmisler" className={link}>{UI.favorites}</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-(--container-content) flex-col gap-1 px-4 py-4 text-xs text-faint md:flex-row md:items-center md:justify-between">
          <p>© {year} AVTOSH.AZ</p>
          <p>Azərbaycanda avtomobil və motosiklet elanları</p>
        </div>
      </div>
    </footer>
  );
}
