import Link from "next/link";
import { ADMIN } from "@/lib/marketplace/labels";
import { PageHeading } from "@/components/ui/page-heading";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminDashboard } from "@/services/admin";

export const dynamic = "force-dynamic";

const ICONS: Record<string, React.ReactNode> = {
  "stat-users": <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75" />,
  "stat-active": <path d="M5 13l1.6-4a2 2 0 0 1 1.9-1.3h7a2 2 0 0 1 1.9 1.3L19 13v4h-1.5a1.7 1.7 0 0 1-3.4 0H9.9a1.7 1.7 0 0 1-3.4 0H5v-4z" />,
  "stat-moderation": <path d="M12 3l7 3v5c0 4.5-3 8.6-7 10-4-1.4-7-5.5-7-10V6l7-3zM9 12l2 2 4-4" />,
  "stat-payment-required": <path d="M3 8h18M3 8v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8M3 8l2-3h14l2 3M7 14h4" />,
  "stat-pending-payments": <path d="M12 7v5l3 3M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z" />,
  "stat-reports": <path d="M12 8v5m0 3.5v.5M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
};

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
      <PageHeading title={ADMIN.dashboard} />
      <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <li key={card.testid}>
            <Link
              href={card.href}
              className="flex items-start justify-between gap-3 rounded-card border border-line bg-raised p-4 shadow-card transition-shadow hover:shadow-raised"
              data-testid={card.testid}
            >
              <span>
                <span className="block text-2xl font-extrabold tracking-tight text-navy">{card.value}</span>
                <span className="mt-1 block text-sm text-muted">{card.label}</span>
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sunken text-slate-strong">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {ICONS[card.testid]}
                </svg>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
