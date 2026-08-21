import { UI } from "@/lib/marketplace/labels";

/** Neutral local placeholder for missing/failed vehicle images (no external assets). */
export function VehiclePlaceholder({ className = "" }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label={UI.imageUnavailable}
      className={`flex h-full w-full items-center justify-center bg-line/60 text-muted ${className}`}
    >
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M3 13l2-5a2 2 0 0 1 1.9-1.3h10.2A2 2 0 0 1 19 8l2 5v4a1 1 0 0 1-1 1h-1a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H4a1 1 0 0 1-1-1v-4z" />
        <circle cx="7" cy="17" r="1" />
        <circle cx="17" cy="17" r="1" />
      </svg>
    </div>
  );
}
