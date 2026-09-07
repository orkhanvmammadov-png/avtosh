import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only: the on-screen route-indicator badge renders bottom-left,
  // exactly over the seller wizard's fixed mobile action bar, and its
  // portal intercepts pointer events (breaks real taps and E2E clicks
  // on "Geri"). Compile/runtime errors still surface without it.
  devIndicators: false,
};

export default nextConfig;
