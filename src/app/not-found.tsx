import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { UI } from "@/lib/marketplace/labels";

export default function NotFound() {
  return (
    <section className="py-24 text-center" aria-labelledby="nf-title">
      <h1 id="nf-title" className="text-2xl font-bold text-navy">{UI.notFoundTitle}</h1>
      <p className="mt-2 text-muted">{UI.notFoundHint}</p>
      <Link href="/" className={buttonClasses("primary", "mt-8")}>{UI.backHome}</Link>
    </section>
  );
}
