import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { AccountNav } from "@/components/seller/account-nav";
import { LogoutButton } from "@/components/shared/logout-button";
import { UI } from "@/lib/marketplace/labels";
import { maskPhone } from "@/auth/phone";

export const metadata: Metadata = {
  title: `${UI.account} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/** Minimal buyer profile shell (Phase 4.10). Seller dashboard is a later phase. */
export default async function ProfilePage() {
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    redirect("/giris?return_to=%2Fprofil");
  }
  const { user } = auth;
  return (
    <div className="py-6" data-testid="profile-page">
      <AccountNav active="profile" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-navy">{UI.account}</h1>
      {user.status === "BLOCKED" ? (
        <p role="status" className="mt-4 rounded-control border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-deep" data-testid="blocked-notice">
          {UI.accountBlocked}
        </p>
      ) : null}
      <section className="mt-6 max-w-md rounded-card border border-line bg-raised p-6 shadow-card">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{UI.phoneLabel}</dt>
            <dd className="font-medium text-navy" data-testid="profile-phone">{maskPhone(user.phone_e164)}</dd>
          </div>
          {user.display_name ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Ad</dt>
              <dd className="font-medium text-navy">{user.display_name}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      <nav aria-label={UI.account} className="mt-6 flex max-w-md flex-col gap-2">
        <Link href="/profil/elanlar" className="rounded-control border border-line bg-raised px-4 py-3 text-sm font-medium text-navy shadow-card transition-colors hover:border-line-strong hover:bg-surface" data-testid="profile-my-listings-link">
          {UI.myListings}
        </Link>
        <Link href="/profil/secilmisler" className="rounded-control border border-line bg-raised px-4 py-3 text-sm font-medium text-navy shadow-card transition-colors hover:border-line-strong hover:bg-surface" data-testid="profile-favorites-link">
          {UI.favorites}
        </Link>
        <Link href="/elan-yerlesdir" className="rounded-control border border-line bg-raised px-4 py-3 text-sm font-medium text-navy shadow-card transition-colors hover:border-line-strong hover:bg-surface">
          {UI.postListing}
        </Link>
        <LogoutButton className="inline-flex justify-start border border-line bg-raised px-4 shadow-card" />
      </nav>
    </div>
  );
}
