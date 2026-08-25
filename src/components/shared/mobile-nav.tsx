"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { UI } from "@/lib/marketplace/labels";

const LINKS = [
  { href: "/elanlar?category=CAR", label: UI.cars },
  { href: "/elanlar?category=MOTORCYCLE", label: UI.motorcycles },
];

/** Native <dialog> drawer: focus trapped by the browser, Esc closes. */
export function MobileNav() {
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
        className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg text-navy md:hidden"
        onClick={() => dialogRef.current?.showModal()}
        data-testid="mobile-menu-button"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Naviqasiya"
        className="m-0 h-dvh max-h-none w-80 max-w-[85vw] bg-white p-0 backdrop:bg-navy/40 open:flex open:flex-col"
        data-testid="mobile-menu"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-lg font-bold text-navy">{UI.brand}</span>
          <button
            type="button"
            aria-label="Menyunu bağla"
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg"
            onClick={() => dialogRef.current?.close()}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <nav aria-label="Mobil naviqasiya" className="flex flex-col p-2">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="rounded-lg px-3 py-3 text-base font-medium text-navy hover:bg-surface" onClick={() => dialogRef.current?.close()}>
              {link.label}
            </Link>
          ))}
          <Link href="/elan-yerlesdir" className="mt-2 rounded-lg bg-primary px-3 py-3 text-center text-base font-semibold text-white" onClick={() => dialogRef.current?.close()}>
            {UI.postListing}
          </Link>
          <Link href="/daxil-ol" className="rounded-lg px-3 py-3 text-base font-medium text-navy hover:bg-surface" onClick={() => dialogRef.current?.close()}>
            {UI.login}
          </Link>
        </nav>
      </dialog>
    </>
  );
}
