import Link from "next/link";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { LogoutButton } from "@/components/shared/logout-button";
import { MobileNav } from "@/components/shared/mobile-nav";
import { UI } from "@/lib/marketplace/labels";

/**
 * Session-aware public header (server component). The cookie session is
 * the single source of truth — no client-side auth guessing.
 */
export async function SiteHeader() {
  const auth = await getCurrentAuthFromCookies();
  const authed = auth !== null;
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
        <div className="flex items-center gap-2" data-testid={authed ? "header-authed" : "header-anonymous"}>
          {authed ? (
            <>
              <Link href="/profil/elanlar" className="hidden rounded-lg px-3 py-3 text-sm font-medium text-navy hover:bg-surface lg:inline-flex" data-testid="header-my-listings">
                {UI.myListings}
              </Link>
              <Link href="/profil/secilmisler" className="hidden rounded-lg px-3 py-3 text-sm font-medium text-navy hover:bg-surface lg:inline-flex" data-testid="header-favorites">
                {UI.favorites}
              </Link>
              <Link href="/profil" className="hidden rounded-lg px-3 py-3 text-sm font-medium text-navy hover:bg-surface lg:inline-flex" data-testid="header-profile">
                {UI.profile}
              </Link>
              <LogoutButton className="hidden lg:inline-flex" />
            </>
          ) : (
            <Link href="/giris" className="hidden rounded-lg px-3 py-3 text-sm font-medium text-navy hover:bg-surface md:inline-flex" data-testid="header-login">
              {UI.login}
            </Link>
          )}
          <Link
            href={authed ? "/elan-yerlesdir" : "/giris?return_to=%2Felan-yerlesdir"}
            className="hidden min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover md:inline-flex"
          >
            {UI.postListing}
          </Link>
          <MobileNav authed={authed} buttonClassName={authed ? "lg:hidden" : "md:hidden"} />
        </div>
      </div>
    </header>
  );
}
