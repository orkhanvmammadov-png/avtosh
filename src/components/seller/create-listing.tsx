"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SELLER } from "@/lib/marketplace/labels";
import { createListing } from "@/lib/seller/owner-api";

/**
 * Explicit draft creation — nothing is created on page load, and the
 * in-flight guard makes refresh/double-click safe: one click, one
 * draft, then straight into the wizard.
 */
export function CreateListing({ categories }: { categories: { id: string; code: string; name: string }[] }) {
  const router = useRouter();
  const [category, setCategory] = useState(categories[0]?.code ?? "CAR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const listing = await createListing(category);
      router.push(`/elan-yerlesdir/${listing.id}`);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-line bg-raised p-5" data-testid="create-listing">
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-slate-strong">{SELLER.chooseCategory}</legend>
        <div className="flex flex-wrap gap-2">
          {categories.map((item) => (
            <label
              key={item.id}
              className={`inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-control border px-4 text-sm font-semibold transition-colors duration-150 ${
                category === item.code ? "border-primary bg-primary text-white" : "border-line-strong bg-raised text-ink hover:border-primary hover:text-primary"
              }`}
            >
              <input
                type="radio"
                name="category"
                value={item.code}
                checked={category === item.code}
                onChange={() => setCategory(item.code)}
                className="accent-primary"
                data-testid={`create-category-${item.code}`}
              />
              {item.name}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          Elan yaradılmadı. Yenidən cəhd edin.
        </p>
      ) : null}
      <Button className="mt-4 w-full sm:w-auto" disabled={busy} onClick={() => void create()} data-testid="create-listing-button">
        {busy ? SELLER.saving : SELLER.createListing}
      </Button>
    </div>
  );
}
