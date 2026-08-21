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
  className = "",
}: {
  src: string | null;
  alt: string;
  priority?: boolean;
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
      className={`h-full w-full object-cover ${className}`}
    />
  );
}
