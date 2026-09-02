import { CameraOff } from "lucide-react";
import { UI } from "@/lib/marketplace/labels";

/** Approved missing-image tile: soft surface + camera-off + label. */
export function VehiclePlaceholder({ className = "" }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label={UI.imageUnavailable}
      className={`flex h-full w-full flex-col items-center justify-center gap-1.5 bg-sunken text-slate-strong ${className}`}
    >
      <CameraOff size={28} strokeWidth={1.75} aria-hidden="true" />
      <span className="text-[11px] font-medium">Şəkil yoxdur</span>
    </div>
  );
}
