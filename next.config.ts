import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only: the on-screen route-indicator badge renders bottom-left,
  // exactly over the seller wizard's fixed mobile action bar, and its
  // portal intercepts pointer events (breaks real taps and E2E clicks
  // on "Geri"). Compile/runtime errors still surface without it.
  devIndicators: false,
  // E2E-only escape hatch: the read-only Playwright server runs a
  // second `next dev` in this directory, and the dev-server lock
  // lives inside the dist dir. Unset everywhere else (default .next).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
