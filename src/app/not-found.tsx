import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { UI } from "@/lib/marketplace/labels";

/**
 * Global 404 boundary. It renders INSIDE whatever layout chain owns
 * the failing segment (public pages get the marketing chrome; a staff
 * guard's notFound() renders bare — no portal disclosure), so the
 * content itself stays chrome-less and centered.
 */
export default function NotFound() {
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center py-24 text-center" aria-labelledby="nf-title">
      <p className="text-6xl font-extrabold tracking-tight text-line-strong">404</p>
      <h1 id="nf-title" className="mt-4 text-2xl font-bold text-navy">{UI.notFoundTitle}</h1>
      <p className="mt-2 text-sm text-muted">{UI.notFoundHint}</p>
      <Link href="/" className={buttonClasses("primary", "mt-8")}>{UI.backHome}</Link>
    </section>
  );
}
