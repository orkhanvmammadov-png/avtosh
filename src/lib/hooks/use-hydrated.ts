"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * False during SSR/pre-hydration, true the moment React is live.
 * Interactive staff/admin controls gate on this so a click on a
 * freshly loaded page can only land on a live handler (the accepted
 * Phase 4.14 determinism pattern).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}
