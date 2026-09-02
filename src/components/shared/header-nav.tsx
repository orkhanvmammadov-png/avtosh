"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { UI } from "@/lib/marketplace/labels";

/**
 * Public header navigation with the approved active treatment: green
 * underline on the current section (client-side because the active
 * category lives in the URL query).
 */
const LINKS = [
  { href: "/elanlar?category=CAR", label: UI.cars, match: (p: string, c: string | null) => p === "/elanlar" && c !== "MOTORCYCLE" },
  { href: "/elanlar?category=MOTORCYCLE", label: UI.motorcycles, match: (p: string, c: string | null) => p === "/elanlar" && c === "MOTORCYCLE" },
];

export function HeaderNav({ authed }: { authed: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const category = params.get("category");
  const base =
    "relative inline-flex min-h-12 items-center px-3 text-sm font-medium transition-colors duration-150";
  const idle = "text-on-navy-muted hover:text-white";
  const active =
    "text-white after:absolute after:inset-x-3 after:bottom-1.5 after:h-0.5 after:rounded-full after:bg-green-dark";
  return (
    <nav aria-label="Əsas naviqasiya" className="hidden items-center gap-1 md:flex">
      {LINKS.map((link) => {
        const isActive = link.match(pathname, category);
        return (
          <Link key={link.href} href={link.href} aria-current={isActive ? "page" : undefined} className={`${base} ${isActive ? active : idle}`}>
            {link.label}
          </Link>
        );
      })}
      {authed ? (
        <Link
          href="/profil/secilmisler"
          aria-current={pathname === "/profil/secilmisler" ? "page" : undefined}
          className={`${base} ${pathname === "/profil/secilmisler" ? active : idle}`}
        >
          {UI.favorites}
        </Link>
      ) : null}
    </nav>
  );
}
