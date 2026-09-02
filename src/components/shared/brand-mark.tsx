import Link from "next/link";

/**
 * Approved AVTOSH brand mark (design handoff assets/). The blade path
 * is taken verbatim from blade.svg; the wordmark is composed inline
 * with the loaded Fira Sans 800 because the supplied wordmark SVGs
 * carry <text> elements that cannot self-load webfonts when embedded
 * as external images (documented adaptation — geometry, tracking and
 * the 52%-cap-height green ".AZ" follow the construction spec).
 *
 * Green on light = #147A4E, green on navy = #2FAE74; gold never
 * appears in the mark.
 */

export function Blade({ tone = "light", size = 22 }: { tone?: "light" | "dark"; size?: number }) {
  return (
    <svg
      width={(size * 24) / 28}
      height={size}
      viewBox="0 0 24 28"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M4 26 L11.6 2 H20 L12.4 26 Z" fill={tone === "dark" ? "#2FAE74" : "#147A4E"} />
    </svg>
  );
}

export function BrandMark({
  tone = "light",
  href = "/",
  size = "md",
}: {
  /** light = ink wordmark (light surfaces); dark = white wordmark (navy). */
  tone?: "light" | "dark";
  href?: string | null;
  size?: "md" | "sm";
}) {
  const text = tone === "dark" ? "text-white" : "text-ink";
  const az = tone === "dark" ? "text-green-dark" : "text-primary";
  const wordmark = (
    <span className="flex items-center gap-1.5">
      <Blade tone={tone} size={size === "md" ? 22 : 18} />
      <span
        className={`font-extrabold leading-none tracking-[0.02em] ${text} ${size === "md" ? "text-[19px]" : "text-base"}`}
      >
        AVTOSH
        <span className={`${az} ${size === "md" ? "text-[13px]" : "text-[11px]"} font-bold`}>.AZ</span>
      </span>
    </span>
  );
  if (href === null) return wordmark;
  return (
    <Link href={href} aria-label="AVTOSH.AZ — ana səhifə" className="inline-flex items-center">
      {wordmark}
    </Link>
  );
}
