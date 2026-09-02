import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { BrandMark } from "@/components/shared/brand-mark";
import { HeaderNav } from "@/components/shared/header-nav";
import { LogoutButton } from "@/components/shared/logout-button";
import { MobileNav } from "@/components/shared/mobile-nav";
import { Container } from "@/components/ui/container";
import { UI } from "@/lib/marketplace/labels";

/**
 * Approved navy public header (screens.md Home): brand · nav with
 * green active underline · account links · permanent green
 * "+ Elan yerləşdir" CTA. Session-aware server component — the
 * cookie session is the single source of truth.
 */
export async function SiteHeader() {
  const auth = await getCurrentAuthFromCookies();
  const authed = auth !== null;
  const quietLink =
    "hidden min-h-12 items-center px-3 text-sm font-medium text-on-navy-muted transition-colors duration-150 hover:text-white lg:inline-flex";
  return (
    <header className="sticky top-0 z-40 bg-navy text-white">
      <Container className="flex h-14 items-center justify-between gap-4 xl:h-[62px]">
        <BrandMark tone="dark" />
        <Suspense fallback={<nav className="hidden md:flex" aria-label="Əsas naviqasiya" />}>
          <HeaderNav authed={authed} />
        </Suspense>
        <div className="flex items-center gap-1.5" data-testid={authed ? "header-authed" : "header-anonymous"}>
          {authed ? (
            <>
              <Link href="/profil/elanlar" className={quietLink} data-testid="header-my-listings">
                {UI.myListings}
              </Link>
              <Link href="/profil/secilmisler" className="hidden" data-testid="header-favorites">
                {UI.favorites}
              </Link>
              <Link href="/profil" className={quietLink} data-testid="header-profile">
                {UI.profile}
              </Link>
              <LogoutButton className="hidden text-on-navy-muted hover:bg-white/10 hover:text-white lg:inline-flex" />
            </>
          ) : (
            <Link
              href="/giris"
              className="hidden min-h-12 items-center px-3 text-sm font-medium text-on-navy-muted transition-colors duration-150 hover:text-white md:inline-flex"
              data-testid="header-login"
            >
              {UI.login}
            </Link>
          )}
          <Link
            href={authed ? "/elan-yerlesdir" : "/giris?return_to=%2Felan-yerlesdir"}
            aria-label={UI.postListing}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control bg-primary px-3 text-[13.5px] font-semibold tracking-[0.01em] text-white transition-colors duration-150 hover:bg-primary-hover active:bg-primary-pressed max-md:min-h-12 md:px-4"
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
            <span className="hidden sm:inline">{UI.postListing}</span>
          </Link>
          <MobileNav authed={authed} buttonClassName={authed ? "lg:hidden" : "md:hidden"} />
        </div>
      </Container>
    </header>
  );
}
