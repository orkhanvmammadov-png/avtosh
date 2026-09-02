import type { Metadata } from "next";
import { Fira_Sans, Fira_Sans_Condensed } from "next/font/google";
import "./globals.css";

/**
 * Approved brand typography (design handoff tokens.md): Fira Sans
 * 400/500/600/700/800 + Fira Sans Condensed 600/700 (prices/numerals
 * only), latin + latin-ext (full Azerbaijani coverage — Ə ə Ğ ğ I ı
 * İ i Ş ş Ç ç Ö ö Ü ü), display swap. Self-hosted via next/font — no
 * external font links, automatic fallback metrics (minimal CLS).
 */
const firaSans = Fira_Sans({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-fira-sans",
});
const firaSansCondensed = Fira_Sans_Condensed({
  weight: ["600", "700"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-fira-condensed",
});

/**
 * Canonical origin for metadata URL resolution (OG/Twitter images).
 * Environment-aware: NEXT_PUBLIC_APP_URL when configured; localhost
 * only outside production builds. In production WITHOUT the env var,
 * metadataBase stays unset on purpose — Next's build warning then
 * marks the unfinished origin configuration instead of silently
 * canonicalizing localhost (production-readiness checkpoint).
 */
const siteOrigin =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");

export const metadata: Metadata = {
  ...(siteOrigin === undefined ? {} : { metadataBase: new URL(siteOrigin) }),
  title: { default: "AVTOSH.AZ — avtomobil və motosiklet elanları", template: "%s — AVTOSH.AZ" },
  description: "Azərbaycanda avtomobil və motosiklet alqı-satqı elanları. Premium və yeni elanlar, rahat axtarış.",
  applicationName: "AVTOSH.AZ",
};

/**
 * Root layout carries only the document shell — the public site and
 * the staff portals mount their own chrome via route groups (URLs
 * are unchanged; groups are invisible in the path).
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="az" className={`${firaSans.variable} ${firaSansCondensed.variable}`}>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-raised focus:px-4 focus:py-2 focus:shadow-overlay">
          Məzmuna keç
        </a>
        {children}
      </body>
    </html>
  );
}
