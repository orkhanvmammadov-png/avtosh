import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
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
    <div className="py-8" data-testid="profile-page">
      <h1 className="text-2xl font-bold text-navy">{UI.account}</h1>
      {user.status === "BLOCKED" ? (
        <p role="status" className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" data-testid="blocked-notice">
          {UI.accountBlocked}
        </p>
      ) : null}
      <section className="mt-6 max-w-md rounded-card border border-line bg-white p-6">
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
        <Link href="/profil/secilmisler" className="rounded-lg border border-line bg-white px-4 py-3 text-sm font-medium text-navy hover:bg-surface" data-testid="profile-favorites-link">
          {UI.favorites}
        </Link>
        <Link href="/elan-yerlesdir" className="rounded-lg border border-line bg-white px-4 py-3 text-sm font-medium text-navy hover:bg-surface">
          {UI.postListing}
        </Link>
        <LogoutButton className="justify-start border border-line bg-white px-4" />
      </nav>
    </div>
  );
}
