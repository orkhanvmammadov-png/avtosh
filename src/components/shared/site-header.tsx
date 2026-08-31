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
  const navLink =
    "inline-flex min-h-12 items-center rounded-control px-3 text-sm font-medium text-slate-strong transition-colors hover:bg-surface hover:text-navy";
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-raised/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-(--container-content) items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2" aria-label={`${UI.brand} — ana səhifə`}>
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l1.6-4a2 2 0 0 1 1.9-1.3h7a2 2 0 0 1 1.9 1.3L19 13v4h-1.5a1.7 1.7 0 0 1-3.4 0H9.9a1.7 1.7 0 0 1-3.4 0H5v-4z" />
            </svg>
          </span>
          <span className="text-xl font-extrabold tracking-tight text-navy">
            AVTOSH<span className="text-primary">.AZ</span>
          </span>
        </Link>
        <nav aria-label="Əsas naviqasiya" className="hidden items-center gap-1 md:flex">
          <Link href="/elanlar?category=CAR" className={navLink}>
            {UI.cars}
          </Link>
          <Link href="/elanlar?category=MOTORCYCLE" className={navLink}>
            {UI.motorcycles}
          </Link>
        </nav>
        <div className="flex items-center gap-1.5" data-testid={authed ? "header-authed" : "header-anonymous"}>
          {authed ? (
            <>
              <Link href="/profil/elanlar" className={`hidden lg:inline-flex ${navLink}`} data-testid="header-my-listings">
                {UI.myListings}
              </Link>
              <Link href="/profil/secilmisler" className={`hidden lg:inline-flex ${navLink} gap-1.5`} data-testid="header-favorites">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 21s-7.5-4.6-10-9.2C.4 8.6 2.3 5 5.7 5c2 0 3.4 1.1 4.3 2.6h4C14.9 6.1 16.3 5 18.3 5c3.4 0 5.3 3.6 3.7 6.8C19.5 16.4 12 21 12 21z" />
                </svg>
                {UI.favorites}
              </Link>
              <Link href="/profil" className={`hidden lg:inline-flex ${navLink}`} data-testid="header-profile">
                {UI.profile}
              </Link>
              <LogoutButton className="hidden lg:inline-flex" />
            </>
          ) : (
            <Link href="/giris" className={`hidden md:inline-flex ${navLink}`} data-testid="header-login">
              {UI.login}
            </Link>
          )}
          <Link
            href={authed ? "/elan-yerlesdir" : "/giris?return_to=%2Felan-yerlesdir"}
            className="hidden min-h-12 items-center justify-center gap-1.5 rounded-control bg-primary px-4 text-sm font-semibold text-white shadow-card transition-colors hover:bg-primary-hover md:inline-flex"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {UI.postListing}
          </Link>
          <MobileNav authed={authed} buttonClassName={authed ? "lg:hidden" : "md:hidden"} />
        </div>
      </div>
    </header>
  );
}
