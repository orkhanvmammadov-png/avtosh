# Tokens, A11y, Motion

## Typography (Fira Sans; system hierarchy)
Price heading 14/700 #141A22 (13.5 below 1440) · field label 12/500 #565B63 · control text 13/400 #1B1E24 (selected 500) · placeholder 13/400 #8A8F98 · multi summary = control selected + ellipsis · option row 12.5/400 · price values Fira Sans Condensed 600/14 · unit suffix (AZN) 11/600 #8A8F98 · helper 11/400 #8A8F98 · Axtar 14/600 white (13.5 @1024-) · Təmizlə 13/600 #147A4E · toggle 12.5/500 (600 selected) · collapsed toggle link 12.5/600 #147A4E · count chip 10/600.

## Spacing map
Advanced panel padding 16 18 (14 16 @1024/768; page 16 @390) · compact→advanced rule gap: rule + 14/16 top padding · grid gap 14×16 (13×14 @1024/768; 12 vertical @390) · label→control 6 · range twin gap 8 · price internal: heading→inputs 9-10, inputs→toggles 10 (8-9 in band), stacked inputs gap 8 · toggle gap 8 · option-row padding 0 9, panel padding 6, panel offset 6 · condition toggle gap 8 · action gap 8 (stack) / 10 (row), action padding-top 12-14.

## Color / surface (approved R.2 tokens — no new palette)
surface card #FFFFFF · price emphasis surface #FBFAF8 + navy rule #141A22 (band) / spine rule #E3E0D8 · control bg #FFFFFF · control border #C6C2B6 · hover border #8A8F98 · focus #147A4E + rgba(20,122,78,.25) ring · text #1B1E24 / #565B63 / muted #8A8F98 · brand green #147A4E (hover #0F6440, pressed #0B5136) · selected toggle tint #E7F2EC / text #0F6440 · panel #FFFFFF, border #E3E0D8 · dividers #E3E0D8 (zone) / #EDEBE4 (minor) · swatch border rgba(0,0,0,.15) · clear ✕ #8A8F98 → hover #B3261E.

## Radius / shadow
Control & buttons r6 · price band r 0 8 8 0 · panel r8 · chips r4 (navy "6") / r999 (count chip) · panel shadow 0 16px 40px rgba(20,26,34,.2) · card keeps its existing overlay shadow · controls flat (no shadow).

## Icons (Lucide, 2px stroke — never emoji)
chevron-down/up 14 (trigger) · check 12 (toggles) / 11 white (checkboxes) · x 12 (group clear) · search 15 (compact row CTA only).

## Accessibility
Real <label> per field · Home-managed focus order = DOM order 1–10 · triggers: aria-expanded + aria-controls, aria-haspopup listbox-like panel with real checkboxes · Kredit/Barter/Vəziyyət: <button aria-pressed> · Escape closes and returns focus to trigger · outside click closes · keyboard: Tab across triggers, Enter/Space open+toggle, arrows across options · visible focus always (2px green, offset 2 — never default blue) · selection never color-only (✓ + border + weight) · swatch always with text label · touch targets ≥44px @390 (controls h44, option rows h44, Axtar h48, toggles h40+).

## Animation
Expand/collapse: 240ms ease on height/opacity (grid-template-rows 0fr→1fr or max-height) — optional; shipping without animation is acceptable. Panels: instant or ≤150ms opacity. Hover/focus: 150ms ease-out color/border. Nothing else animates; no entrance motion.