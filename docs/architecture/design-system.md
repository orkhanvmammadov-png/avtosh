# Design System — Approved Claude Design (Phase 4.17R)

**Visual source of truth:** the owner-approved design handoff at
`design_handoff_avtosh/` (kept outside this repository) — Direction C
"Premium Marketplace Hybrid". Its `tokens.md`, `components.md`,
`screens.md` and `contracts.md` are authoritative for presentation.
The codebase remains the authoritative source for all behavior: APIs,
data, auth, payments, lifecycle, moderation, RBAC, concurrency and
idempotency rules. On conflict, behavior is preserved and the
presentation adapts — business rules are never changed for styling.

## Principles

- **One action color.** Racing green `#147A4E` is the only action
  color. On navy surfaces green shifts to `#2FAE74` for contrast.
- **Navy stage, paper ground.** Deep navy `#141A22` frames the brand
  moments (header, home hero, listing-detail stage, footer, staff
  chrome); content sits on warm paper `#F5F4F0` with white raised
  panels and flat 1px borders — cards carry no shadows (the home hero
  search panel is the single floating exception).
- **Gold only in the Premium chip.** `#D9B45B` never appears
  anywhere else. Boost is green, never amber; boosted public
  placements always carry the required "Reklam" ad marking.
- **Typography.** Fira Sans 400–800 (with Fira Sans Condensed
  600/700 for prices and numerals only), loaded through
  `next/font/google` with `latin` + `latin-ext` subsets (Azerbaijani
  ə ğ ı İ ş ç ö ü verified). Exposed as `--font-fira-sans` /
  `--font-fira-condensed`.

## Tokens

All tokens live in `src/app/globals.css` under `@theme` (Tailwind 4)
and mirror `design_handoff_avtosh/tokens.md`: brand greens, navy
stage colors, ink/text tiers, warm-paper surfaces and lines, semantic
feedback tints (borderless chips + left-rule banners), promotion
accents, scrim, radii (control 6 / card 10 / modal 14 / staff 4 /
pill), elevation (raised 0 1px 2px, overlay 0 16px 40px) and motion
(150ms hover, 240ms drawers, 1.2s shimmer). Compatibility aliases for
pre-handoff token names remain at the bottom of the block until the
last legacy classes are swept.

## Responsive model

Breakpoints: mobile `<768`, tablet `md:` 768–1023, desktop `desk:`
1024–1439, wide `xl:` ≥1440 (rem-based). Content max width 1360px
via `--container-content`; gutters 16/24/32/40 through the shared
`<Container>` (`src/components/ui/container.tsx`). The public layout
leaves `<main>` unconstrained so pages own their full-bleed navy
bands and wrap content in `<Container>` — horizontal overflow is
prevented architecturally, never masked with `overflow-x: hidden`.
Card grids: 4 columns at `xl`, 3 at `md`, 1 on mobile.

Sticky/fixed z-order: public header 40, search toolbar 35, sheets 60
(scrim 55), contact/wizard bottom bars 50, rails/panels 10, staff
sidebar 30.

## Key component recipes

- Buttons: primary/secondary/ghost/danger plus premium (navy+gold)
  and boost (green tint) — `src/components/ui/button.tsx`.
- Controls: 40px (48px mobile) `line-strong` borders, green focus
  ring — `src/components/ui/controls.tsx`.
- Status chips: borderless tints with a leading dot
  (`status-chip.tsx`); staff variant at r4 with a mono raw-code
  suffix where the E2E contract requires it.
- Listing cards are frameless: rounded image block, condensed price,
  title, spec line — no card border (`listing-card.tsx`).
- Brand: the blade mark is drawn from the approved `blade.svg` path;
  the wordmark is composed inline in Fira Sans 800
  (`brand-mark.tsx`) because the supplied wordmark SVGs use `<text>`
  and cannot self-load webfonts.

## Documented presentation deviations (owner-accepted directions)

1. Promoted (boosted) cards and the boosted detail badge keep the
   functional "Reklam" ad-label contract; chips render title-case
   text under CSS `uppercase` so text assertions stay stable.
2. Login keeps ONE real phone input (full E.164 typed value — no
   split +994 prefix) and ONE real OTP input under a six-box visual
   overlay, preserving fill/paste/autofill contracts.
3. No mark-sold or draft-delete actions exist anywhere (owner
   decisions A/B); search is count-neutral ("Nəticələri göstər", no
   fake totals) and pagination stays cursor-based "Daha çox göstər"
   (decisions C/D).
4. The app icon reuses the approved blade favicon (no webfont-
   dependent assets are shipped).
5. The listing report flow stays inline (not a modal); the moderator
   decision panel keeps buttons + two-step confirm (not radios); the
   promotion purchase keeps the type switcher with one package group
   at a time. These preserve accepted, tested interaction logic.
6. Refund initiation in the admin panel remains BLOCKED pending the
   official provider contract — the note is styled, never enabled.

## Accessibility notes

- Focus: global 2px green `:focus-visible` ring, offset 2.
- Contrast: ink on paper 14.9:1; secondary text `#565B63` 5.9:1;
  green-on-dark `#2FAE74` on navy ≈ 6.0:1; gold `#D9B45B` on navy ≈
  7.4:1. Muted `#8A8F98` (≈2.9:1 on paper) is reserved for
  non-essential metadata per the handoff and never used for
  actionable or unique information.
- Touch targets: 48px minimum on mobile (44px+ elsewhere);
  `prefers-reduced-motion` collapses all animation.
