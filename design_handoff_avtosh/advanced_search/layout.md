# Layout & States

## Reading order (DOM order = visual order; CSS must not reorder against it)
General (compact/core search, above the advanced grid): Category tabs · Marka · Model · **Şəhər** (general filter — same control geometry, lives in the compact row, never numbered).
Vehicle-specific: 1 Ban növü · 2 Yürüş, km · 3 Buraxılış ili · 4 Mühərrikin həcmi, sm³ · 5 Rəng · 6 Qiymət, AZN (+ Kredit mümkündür + Barter inside the block) · 7 Yanacaq növü · 8 Ötürücü · 9 Sürətlər qutusu · 10 Avtomobil vəziyyəti.
At 1440/1024 the price spine renders right of the spec grid but MUST remain position 6 in DOM (grid placement handles visuals; source order stays 1–10).

## 1440 (canonical)
- Container: the existing white Home search card (r12, border #E3E0D8, overlay shadow). Advanced area separated from compact row by a 1px #E3E0D8 top rule.
- Structure: CSS Grid, `grid-template-columns: 1fr 340px` — left = spec zone, right = **price spine**, split by a 1px #E3E0D8 vertical rule (border-left on spine).
- Spec zone: padding 16 18 18; inner CSS Grid `repeat(3, 1fr)`, gaps 14 (row) × 16 (col). Cells in order: Ban · Yürüş · İl(range) · Mühərrik(range) · Rəng · Yanacaq · Ötürücü · Sürətlər · Vəziyyət (toggle pair, single cell).
- Price spine: padding 16 18 18; flex column. Top: navy "6" chip + heading; stacked Min/Maks (gap 8); Kredit/Barter flex row (gap 8, wrap) + helper line; `margin-top:auto` action stack: Axtar (full-width primary) over Təmizlə (ghost, centered), gap 8, padding-top 14.
- Multi-select panels anchor to their trigger, overlay content (no push-down).

## 1024 — changes from 1440
- Outer grid → `1fr 300px` (spine narrows). Spec zone → 2 columns, gaps 13×14, padding 14 16 16. Vəziyyət spans both columns. Everything else identical (spine content, order, geometry, actions in spine).

## 768 — changes
- Spine dissolves: single zone, padding 14 16 16. Spec grid 2 columns (gaps 13×14): Ban · Yürüş / İl(range) / Mühərrik(range) / Rəng (control capped at one column width).
- **Price band** at position 6, full width between rows 5 and 7: 3px navy #141A22 left rule, bg #FBFAF8, radius 0 8 8 0, padding 12 14, margin 14 0. Inside: chip+heading row; Min/Maks 2-col grid gap 8 (fields bg #fff); toggles row gap 8 below.
- Rows 7–10 resume the 2-col grid (Yanacaq · Ötürücü / Sürətlər · Vəziyyət pair).
- Action row: 1px #EDEBE4 top rule, margin-top 14, padding-top 12; right-aligned flex: Təmizlə ghost + Axtar primary (padding 11 32).

## 390 — changes
- Single column, page padding 16, vertical gap 12 between fields. Controls h44 (touch). Ranges stay **side-by-side** (2-col grid, gap 8) — never stacked.
- Price band: same recipe as 768 (navy rule + #FBFAF8), Min/Maks side-by-side h44, toggles h40 wrap below.
- Vəziyyət: 2-col grid, toggles h44, centered labels.
- Actions: full-width Axtar (h48, primary) then Təmizlə ghost centered below. No sticky behavior (none in approved design). No horizontal overflow at any point; multi-select panel = trigger width (100% of column), max-height ~60vh with inner scroll.

## Grid/Flex recommendation
Outer split, spec zone, range pairs, Min/Maks, condition pair @390 → **CSS Grid** (rigid track parity is the point — Price≡Engine widths fall out of equal tracks). Kredit/Barter row, action rows, trigger internals (label/✕/chevron), option rows → **Flex** with gap. Price spine internal → flex column with margin-top:auto action anchor.

## States
- **Collapsed:** compact search only. Toggle link: 12.5/600 brand green "Ətraflı axtarış" + chevron ▼; when persisted selections exist, a count chip (#E7F2EC / #0F6440, r999, 10/600) "n filtr" sits between label and chevron — derive n from current URL/filter state (already available; do not invent a new counter source). Collapse never clears values; only Təmizlə resets.
- **Expanded:** chevron flips ▲; advanced zone appears under the 1px rule inside the same card; Home content pushes down naturally (document flow). Transition: max-height/opacity 240ms ease (see tokens.md); acceptable to ship without animation.
- **Selected (Stage 2 §25 reference):** filled triggers keep h40/44 — value text ink 500, truncating `A, B +n`; a ✕ group-clear (11/600 muted, hover danger) appears before the chevron; numeric fields show ✕ only. Price fields show muted Min/Maks prefix + Condensed 600/14 value + AZN suffix; "Sıfırla" ghost (11/600 green) appears in the price heading row and resets price+toggles only. Toggles show ✓ + tint. Layout metrics identical to default — nothing grows.