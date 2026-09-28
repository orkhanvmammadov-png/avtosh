import { LaunchModeProvider } from "@/components/shared/launch-mode-context";
import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";
import { isReadOnlyLaunch } from "@/lib/config/launch";

/**
 * Public marketplace shell. The main region is intentionally
 * unconstrained — pages own their Containers so approved full-bleed
 * navy stages (hero, detail, footer) span the viewport.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <LaunchModeProvider readOnly={isReadOnlyLaunch()}>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main id="main" className="w-full flex-1">
          {children}
        </main>
        <SiteFooter />
      </div>
    </LaunchModeProvider>
  );
}
