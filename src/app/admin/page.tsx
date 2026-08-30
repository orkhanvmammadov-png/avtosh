import Link from "next/link";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminDashboard } from "@/services/admin";

export const dynamic = "force-dynamic";

/** Lightweight operational landing — DB-derived counts, no warehouse. */
export default async function AdminDashboardPage() {
  await requireAdminPage("/admin");
  const counts = await adminDashboard();
  const cards: { label: string; value: number; href: string; testid: string }[] = [
    { label: ADMIN.users, value: counts.users, href: "/admin/istifadeciler", testid: "stat-users" },
    { label: "Aktiv elanlar", value: counts.active_listings, href: "/admin/elanlar?status=ACTIVE", testid: "stat-active" },
    { label: "Moderasiyada", value: counts.pending_moderation, href: "/moderator/elanlar", testid: "stat-moderation" },
    { label: "Ödəniş gözləyən", value: counts.payment_required, href: "/admin/elanlar?status=PAYMENT_REQUIRED", testid: "stat-payment-required" },
    { label: "Gözləyən ödənişlər", value: counts.pending_payments, href: "/admin/odenisler?status=PENDING", testid: "stat-pending-payments" },
    { label: "Açıq şikayətlər", value: counts.open_reports, href: "/admin/hesabatlar?status=OPEN", testid: "stat-reports" },
  ];
  return (
    <div className="py-6" data-testid="admin-dashboard">
      <h1 className="text-xl font-bold text-navy">{ADMIN.dashboard}</h1>
      <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <li key={card.testid}>
            <Link
              href={card.href}
              className="block rounded-card border border-line bg-white p-4 hover:shadow-md"
              data-testid={card.testid}
            >
              <p className="text-2xl font-extrabold text-navy">{card.value}</p>
              <p className="mt-1 text-sm text-muted">{card.label}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
