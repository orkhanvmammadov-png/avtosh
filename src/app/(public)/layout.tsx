import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";

/**
 * Public marketplace shell. The main region is intentionally
 * unconstrained — pages own their Containers so approved full-bleed
 * navy stages (hero, detail, footer) span the viewport.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="w-full flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
