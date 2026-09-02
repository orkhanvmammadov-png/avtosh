"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { StaffNavItem } from "@/components/staff/staff-shell";

/**
 * Below-desk staff navigation drawer (approved staff shell): native
 * <dialog> like the public MobileNav — focus trapped by the browser,
 * Esc closes. Nav testids live on the desktop sidebar only.
 */
export function StaffDrawer({ nav, portalLabel }: { nav: StaffNavItem[]; portalLabel: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const close = () => dialog.close();
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);
  return (
    <>
      <button
        type="button"
        aria-label="Menyunu aç"
        aria-haspopup="dialog"
        className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-staff text-white desk:hidden"
        onClick={() => dialogRef.current?.showModal()}
        data-testid="staff-menu-button"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <dialog
        ref={dialogRef}
        aria-label={portalLabel}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-navy p-0 text-white backdrop:bg-scrim open:flex open:flex-col"
      >
        <div className="flex items-center justify-between border-b border-navy-border px-4 py-3">
          <span className="text-sm font-bold uppercase tracking-[0.06em] text-on-navy-muted">{portalLabel}</span>
          <button
            type="button"
            aria-label="Menyunu bağla"
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-staff text-white hover:bg-white/10"
            onClick={() => dialogRef.current?.close()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <nav aria-label={portalLabel} className="flex flex-col p-2">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-staff px-3 py-2.5 text-sm font-medium text-on-navy-muted transition-colors duration-150 hover:bg-white/5 hover:text-white"
              onClick={() => dialogRef.current?.close()}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </dialog>
    </>
  );
}
