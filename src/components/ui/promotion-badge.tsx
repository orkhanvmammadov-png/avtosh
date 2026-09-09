import { Zap } from "lucide-react";

/**
 * Approved promotion identity (components.md): PREMIUM = navy chip
 * with gold text (gold exists ONLY here); BOOST = green tint chip
 * with zap. Combined promotions render side-by-side, never merged.
 */
export function PromotionBadge({
  type,
  compact = false,
  label,
  onNavy = false,
}: {
  type: "PREMIUM" | "BOOST";
  compact?: boolean;
  /** Text override for special placements. */
  label?: string;
  /** O.7 navy-stage Premium variant (raised fill + gold hairline) —
      additive; every existing caller keeps the default chip. */
  onNavy?: boolean;
}) {
  const size = compact ? "px-1.5 py-0.5 text-[8.5px]" : "px-2 py-0.5 text-[10px]";
  if (type === "PREMIUM") {
    return (
      <span className={`inline-flex items-center rounded-[5px] font-bold uppercase tracking-wider text-premium ${size} ${onNavy ? "border border-[#4A4636] bg-navy-raised" : "bg-navy"}`}>
        Premium
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-[5px] bg-boost-soft font-bold uppercase tracking-wider text-boost ${size}`}>
      <Zap size={compact ? 9 : 11} strokeWidth={2.5} aria-hidden="true" />
      {label ?? "Boost"}
    </span>
  );
}
