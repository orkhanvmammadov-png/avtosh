import { UI } from "@/lib/marketplace/labels";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-white">
      <div className="mx-auto flex max-w-(--container-content) flex-col gap-2 px-4 py-8 text-sm text-muted md:flex-row md:items-center md:justify-between">
        <p className="font-semibold text-navy">{UI.brand}</p>
        <p>Azərbaycanda avtomobil və motosiklet elanları</p>
      </div>
    </footer>
  );
}
