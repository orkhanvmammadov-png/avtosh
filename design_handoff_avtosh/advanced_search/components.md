# Component Specs

## AdvancedFilterField (standard wrapper)
Label above control: Fira Sans 12/500 #565B63, margin-bottom 6 (Stage 2 renders 5 — use 6, the system token). Optional order numeral is a design-file annotation only — DO NOT ship the grid numbers. Field width = grid track (min-width 0 for truncation). Field-to-field spacing comes from grid gaps only, never margins.

## Standard closed control — MUST MATCH (Ban, Yürüş, İl, Mühərrik, Rəng, Qiymət, Yanacaq, Ötürücü, Sürətlər)
Height 40 (44 @390, min-height equal), border 1px border-strong #C6C2B6, radius 6, bg surface-raised #FFFFFF, padding 0 12 (vertical centering via flex), text 13/400 text-primary #1B1E24, placeholder #8A8F98, selected value weight 500. Chevron: Lucide chevron-down 14, #8A8F98, right-aligned (margin-left auto), flips up + brand green when open. Hover: border #8A8F98. Focus: border #147A4E + 2px ring rgba(20,122,78,.25) (keyboard: outline 2px #147A4E offset 2). Disabled (if ever): bg #EDEBE4, text #8A8F98, 60% border.

## Range recipe — Year · Engine · Price (identical, non-negotiable)
Two sibling controls of the standard geometry in a 2-col grid, gap 8, equal tracks (1fr 1fr) — same height/radius/padding/typography for all three filters. Placeholders "Min"/"Maks"; dropdowns get chevrons, price inputs don't. Side-by-side at every width including 390; never stacked. **Price Min/Max ≡ Engine Min/Max in every dimension** — verify by overlay.

## Price block — final spec
- 1440: right spine, 340px track, border-left 1px #E3E0D8, padding 16 18 18. 1024: same at 300px. 768/390: full-width band — border-left 3px #141A22, bg #FBFAF8, radius 0 8 8 0, padding 12 14, vertical margin 14.
- Heading row: navy chip (bg #141A22, white, 10/700, ls +6%, padding 4 8, r4, content "6") + "Qiymət, AZN" 14/700 #141A22 (13.5 @1024-), gap 8; "Sıfırla" ghost right when price/toggles active.
- Inputs: standard geometry; muted 11/400 "Min"/"Maks" prefix inside when filled; value Fira Sans Condensed 600/14; suffix "AZN" 11/600 #8A8F98 right-aligned inside the field. Stacked (gap 8) in the spine; 2-col in the band.
- Emphasis mechanics (the whole point): dedicated grid region + navy chip/heading + distinct surface/rule + adjacency to Axtar — inputs stay standard-size. Any implementation that enlarges price inputs is wrong.

## Kredit / Barter toggles
Real toggle buttons (aria-pressed), both selectable, living inside the Price block under the inputs (flex row, gap 8, margin-top 10; wrap allowed).
Geometry: h32 (h40 @390 touch), padding 0 12, r6, text 12.5/500.
Default: bg #fff, border 1px #C6C2B6, text #3d4148. Hover: border+text #147A4E. Focus: 2px #147A4E ring offset 2. Selected: bg #E7F2EC, border #147A4E, text #0F6440 600, leading ✓ (Lucide check 12) — state readable without color. Both-selected: both styled identically. Never resemble the primary CTA (no fill, no white text).

## Manual numeric inputs — Qiymət, Yürüş
type/inputmode numeric presentation, manual entry only: no steppers, no browser spinner (hide webkit/moz spin UI). Left-aligned text. Examples: Yürüş placeholder "maks. 123 500"; price "Min"/"Maks". Context units: AZN suffix inside price fields; "km" lives in the Yürüş label only. Mobile: numeric keyboard, h44. Focus per standard control. No currency-formatting logic beyond what exists.

## Year / Engine dropdowns
Standard closed control + chevron. Year options 1900–2027 (functional bound = currentYear+1 — never hardcode 2100). Engine option sequence from existing code (100-step to 6500, 500-step to 10000, 1000-step to 16000). Selected value: ink 500; both filled shows e.g. 2020 | 2027.

## Multi-select system — Rəng, Yanacaq, Sürətlər (one system)
- Closed default: standard control, placeholder "Hamısı"; Rəng shows the multicolor conic swatch before "Hamısı".
- Closed selected: summary "A, B" → "A, B +n" (500 ink, ellipsis truncation, single line — trigger never grows); Rəng prefixes overlapping 12px swatches of first two picks; ✕ group-clear before chevron.
- Open trigger: border #147A4E, chevron up green.
- Panel: anchored below trigger, offset 6, **overlays content** (never pushes; the sole exception is 390 where the flow-anchored panel below the trigger is acceptable per Stage 2 — trigger-width, no modal). Width = trigger width; min 240; Rəng @≥768 may extend to 2-col ~420 max. Max-height 320 desktop / 60vh mobile, inner scroll. r8, border 1px #E3E0D8, shadow 0 16px 40px rgba(20,26,34,.2), padding 6, z-index above card content (≥30).
- Option row: h36 (h44 @390), padding 0 9, r5, 12.5/400, gap 9; hover bg #F5F4F0; focused row = same + 2px inner green outline. Checkbox 16 r4: unchecked border 1.5px #C6C2B6; checked bg #147A4E + white check — real checkboxes.
- Footer: 1px #EDEBE4 top rule, "Təmizlə (n)" 12/600 green left (clears this group only) + muted hint right.
- Interaction contract (existing behavior — preserve): trigger click opens; re-click / outside click / Escape / opening another closes; option click toggles and panel stays open; one open at a time; focus returns to trigger on close.

## Color option
Row: checkbox · swatch · label, gaps 9. Swatch 12px circle, border 1px rgba(0,0,0,.15) (keeps Ağ/Gümüşü/Bej visible). Swatch never replaces the label. 20 catalog colors, 2-col grid @≥768, 1-col @390.

## Vehicle Condition — final block (position 10)
No surface, no dropdown: heading label + two directly visible toggles (same recipe as Kredit/Barter but h40 desktop / h44 @390). Independent AND conditions; both selectable. Layout: flex row gap 8 (1440/1024 single cell; spans 2 cols @1024; 768 grid cell; 390 2-col grid, centered labels). Physically separated from Price by rows 7–9 — never adjacent to Kredit/Barter.

## Şəhər (general)
Stays in the compact/core search row (standard geometry, "Şəhər — hamısı" placeholder), above the advanced rule, unnumbered. No extra spacing rules beyond the compact row's gap 10.

## Action area
1440/1024: inside price spine — Axtar full-width primary (h44, r6, 14/600), Təmizlə ghost centered below (13/600 green), gap 8, anchored to spine bottom. 768: right-aligned flex row after the grid (Təmizlə then Axtar, gap 10) above a 1px #EDEBE4 rule. 390: full-width Axtar h48 then centered Təmizlə. No sticky behavior anywhere. No result counts on any button.