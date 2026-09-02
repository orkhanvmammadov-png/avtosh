import Link from "next/link";
import { BrandMark } from "@/components/shared/brand-mark";
import { Container } from "@/components/ui/container";
import { UI } from "@/lib/marketplace/labels";

/**
 * Approved navy footer strip — brand + existing-route links + © line.
 * Server-rendered (never hydrated), so the year is safe.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const link = "text-sm text-on-navy-muted transition-colors duration-150 hover:text-white";
  return (
    <footer className="mt-16 bg-navy text-white">
      <Container className="grid gap-8 py-10 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <BrandMark tone="dark" href={null} />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-on-navy-muted">
            Azərbaycanda avtomobil və motosiklet elanları — yoxlanılmış elanlar, birbaşa əlaqə,
            təhlükəsiz onlayn ödəniş.
          </p>
        </div>
        <nav aria-label="Kateqoriyalar">
          <p className="text-xs font-semibold uppercase tracking-wide text-on-navy-muted/70">Kateqoriyalar</p>
          <ul className="mt-3 space-y-2">
            <li><Link href="/elanlar?category=CAR" className={link}>{UI.cars}</Link></li>
            <li><Link href="/elanlar?category=MOTORCYCLE" className={link}>{UI.motorcycles}</Link></li>
          </ul>
        </nav>
        <nav aria-label="Hesab">
          <p className="text-xs font-semibold uppercase tracking-wide text-on-navy-muted/70">Hesab</p>
          <ul className="mt-3 space-y-2">
            <li><Link href="/elan-yerlesdir" className={link}>{UI.postListing}</Link></li>
            <li><Link href="/profil/elanlar" className={link}>{UI.myListings}</Link></li>
            <li><Link href="/profil/secilmisler" className={link}>{UI.favorites}</Link></li>
          </ul>
        </nav>
      </Container>
      <div className="border-t border-navy-border">
        <Container className="flex flex-col gap-1 py-4 text-xs text-on-navy-muted md:flex-row md:items-center md:justify-between">
          <p>© {year} AVTOSH.AZ</p>
          <p>Azərbaycanda avtomobil və motosiklet elanları</p>
        </Container>
      </div>
    </footer>
  );
}
