import Link from "next/link";
import { UI } from "@/lib/marketplace/labels";

/**
 * Account/task identity strip shared by the seller-facing pages —
 * the public shell stays, this only orients the account area.
 */
const TABS = [
  { key: "profile", href: "/profil", label: UI.profile },
  { key: "listings", href: "/profil/elanlar", label: UI.myListings },
  { key: "favorites", href: "/profil/secilmisler", label: UI.favorites },
] as const;

export type AccountTab = (typeof TABS)[number]["key"];

export function AccountNav({ active }: { active: AccountTab }) {
  return (
    <nav aria-label={UI.account} className="no-scrollbar -mx-4 overflow-x-auto border-b border-line px-4">
      <ul className="flex gap-1">
        {TABS.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={tab.key === active ? "page" : undefined}
              className={`inline-flex min-h-12 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors duration-150 ${
                tab.key === active
                  ? "border-primary font-semibold text-ink"
                  : "border-transparent font-medium text-slate-strong hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
