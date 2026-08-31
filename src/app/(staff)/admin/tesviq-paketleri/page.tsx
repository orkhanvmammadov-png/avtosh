import { PackageEditor } from "@/components/admin/package-editor";
import { formatPriceMinor } from "@/lib/format";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminPackages } from "@/services/admin";

export const dynamic = "force-dynamic";

/** Promotion package pricing/activation — closes the 4.13 checkpoint. */
export default async function AdminPackagesPage() {
  await requireAdminPage("/admin/tesviq-paketleri");
  const packages = await adminPackages();
  return (
    <div className="py-6" data-testid="admin-packages-page">
      <h1 className="text-2xl font-bold tracking-tight text-navy">{ADMIN.packages}</h1>
      <p className="mt-1 text-xs text-muted">
        Qiymət dəyişiklikləri yalnız GƏLƏCƏK alışlara təsir edir; mövcud ödəniş anlıqları dəyişməzdir.
      </p>
      <ul className="mt-4 space-y-2" data-testid="admin-packages">
        {packages.map((pkg) => (
          <li
            key={pkg.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border border-line bg-raised px-3 py-2"
            data-testid="admin-package-row"
            data-package={`${pkg.type}-${pkg.durationDays}`}
            data-active={pkg.isActive ? "true" : "false"}
          >
            <span className="w-40 text-sm font-semibold text-navy">{pkg.name}</span>
            <span className="text-sm text-muted" data-testid="pkg-current-price">
              {formatPriceMinor(pkg.priceMinor, pkg.currency)}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${pkg.isActive ? "border border-success-line bg-success-soft text-success-deep" : "border border-line bg-sunken text-slate-strong"}`}>
              {pkg.isActive ? ADMIN.active : "Deaktiv"}
            </span>
            <PackageEditor packageId={pkg.id} priceMinor={pkg.priceMinor} isActive={pkg.isActive} version={pkg.version} />
          </li>
        ))}
      </ul>
    </div>
  );
}
