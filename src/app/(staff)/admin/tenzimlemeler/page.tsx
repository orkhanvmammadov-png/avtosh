import { SettingEditor } from "@/components/admin/setting-editor";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminSettings } from "@/services/admin";

export const dynamic = "force-dynamic";

/** Typed system settings — a fixed allowlist, never a generic key/value editor. */
export default async function AdminSettingsPage() {
  await requireAdminPage("/admin/tenzimlemeler");
  const settings = await adminSettings();
  return (
    <div className="py-6" data-testid="admin-settings-page">
      <h1 className="text-2xl font-bold tracking-tight text-ink">{ADMIN.settings}</h1>
      <p className="mt-1 text-xs text-muted">{ADMIN.settingHint}</p>
      <ul className="mt-4 space-y-2" data-testid="admin-settings">
        {settings.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border border-line bg-raised px-3 py-2" data-testid="admin-setting-row" data-setting={s.key}>
            <div className="w-full sm:w-72">
              <p className="text-sm font-semibold text-ink">{s.key}</p>
              {s.description !== null ? <p className="text-xs text-muted">{s.description}</p> : null}
            </div>
            <span className="text-sm text-muted" data-testid="setting-current">{s.value}</span>
            <SettingEditor settingKey={s.key} value={s.value} version={s.version} />
          </li>
        ))}
      </ul>
    </div>
  );
}
