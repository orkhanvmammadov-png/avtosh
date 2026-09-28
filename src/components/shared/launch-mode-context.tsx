"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Client-side mirror of the SERVER's launch mode, provided once by
 * the public layout (a server component reads isReadOnlyLaunch() and
 * feeds it here). Client islands must never compute the mode from
 * their own env — the server value is the single source of truth,
 * and the server gates remain the real enforcement either way.
 */
const LaunchModeContext = createContext(false);

export function LaunchModeProvider({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: ReactNode;
}) {
  return <LaunchModeContext.Provider value={readOnly}>{children}</LaunchModeContext.Provider>;
}

export function useReadOnlyLaunch(): boolean {
  return useContext(LaunchModeContext);
}
