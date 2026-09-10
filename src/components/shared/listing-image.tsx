"use client";

import { useState } from "react";
import { VehiclePlaceholder } from "@/components/shared/vehicle-placeholder";

/**
 * Signed-URL image with graceful fallback: null URL or a load error
 * shows the local placeholder instead of breaking the card/gallery.
 */
export function ListingImage({
  src,
  alt,
  priority = false,
  fit = "cover",
  className = "",
}: {
  src: string | null;
  alt: string;
  priority?: boolean;
  /** O.8 fullscreen viewer: "contain" shows the complete photo without
      cropping; every existing caller keeps the "cover" default. */
  fit?: "cover" | "contain";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) {
    return <VehiclePlaceholder className={className} />;
  }
  return (
    // Signed private-storage URLs on a foreign host; next/image optimization is
    // intentionally not applied to short-lived signed URLs.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onError={() => setFailed(true)}
      className={`${fit === "contain" ? "max-w-full object-contain" : "h-full w-full object-cover"} text-transparent ${className}`}
    />
  );
}
