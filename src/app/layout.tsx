import type { Metadata } from "next";
import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AVTOSH.AZ — avtomobil və motosiklet elanları", template: "%s — AVTOSH.AZ" },
  description: "Azərbaycanda avtomobil və motosiklet alqı-satqı elanları. Premium və yeni elanlar, rahat axtarış.",
  applicationName: "AVTOSH.AZ",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="az">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* App Router root layout: this stylesheet applies to every page (the rule targets the Pages Router _document). */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">
          Məzmuna keç
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-(--container-content) px-4 pb-8">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
