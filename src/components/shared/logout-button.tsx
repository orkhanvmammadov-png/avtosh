"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UI } from "@/lib/marketplace/labels";
import { invalidateFavoriteIds } from "@/lib/marketplace/favorites-client";

export function LogoutButton({ className = "inline-flex" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      invalidateFavoriteIds();
      router.push("/");
      router.refresh();
    }
  }
  return (
    <button
      type="button"
      onClick={() => void logout()}
      disabled={busy}
      data-testid="logout-button"
      className={`min-h-12 items-center rounded-control px-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-sunken disabled:text-muted ${className}`}
    >
      {UI.logout}
    </button>
  );
}
