import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";

/** Public marketplace shell: marketing header + content + footer. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-(--container-content) px-4 pb-8">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
