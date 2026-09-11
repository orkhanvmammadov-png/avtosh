# Components
## Quick Start
Category segmented toggles (h40 desktop / h44 mobile, selected = #E7F2EC + #147A4E border + ✓); Marka/Model/İl/Şəhər selects h40/h44. Order fixed. Loading: control shows inline spinner right; no-result row "Nəticə tapılmadı"; error under field, red border.
## Brand / Model (typeahead)
Search-as-you-type over loaded catalog; dropdown width = trigger, max-height ~320 scroll, option rows h36 (h44 @390 bottom-sheet style overlay), hover #F5F4F0, selected green ✓. Model disabled with hint "Marka seçin" until Brand chosen; Brand change clears stale Model. Keyboard: type→filter, ↑↓, Enter select, Esc close.
## Attribute selects (Year/Engine/Fuel/Transmission/Color/Body/Drive/Moto type)
O.2/O.3/O.4 value contracts verbatim; UUID-backed where code requires. Color options = swatch 12px circle + label, never swatch-only. Standard control: h40 (44 touch), border #C6C2B6, r6, 13/400, chevron right, focus 2px green ring.
## Price / Mileage
Manual numeric, inputmode="numeric", right-context units (AZN/km in label), Condensed 600 value display, grouped thousands display-only. No steppers, no sliders.
## Booleans (Kredit · Barter · Vuruğu yoxdur · Rənglənməyib)
Toggle chips h32–40 (h40+ touch): default white/#C6C2B6; selected #E7F2EC/#147A4E border + ✓ prefix (non-color signal). Condition claims remain seller declarations — no verification implied.
## Photos
Tiles 4:3 r8. Empty: dashed tile "+ Əlavə et" (drag/drop zone desktop: "+ sürüklə"). Uploading: shimmer + %; failed: red tint row "yenidən cəhd ↻"; delete: 20px ✕ top-right; primary: first tile, 2px green border + ƏSAS ŞƏKİL chip; reorder: drag (⠿ handle hint), long-press @mobile; reorder to slot 1 = new primary. Min counter "n/3 minimum" warns amber; max 20 → add tile disabled with note. No backend image changes.
## Features
Grouped expanders ("Təchizat seç (n) ▾"), checkbox rows h36+, selected count in trigger; long lists scroll inside group. No invented features.
## Description
Optional textarea ~4 rows (grows), helper text concise; no fabricated char limit.
## Section card & progress
See layout.md; progress "n/7 tamam" chip top-right + per-card states (○ / ✓ / red-dot needs-attention).
## Review
Preview row + ƏLAQƏ block + fee line + promo cards; every group has Dəyiş (reopens that section in place). Not a full form repeat.
## Autosave chip
"Saxlanılır…" (spinner) / "✓ Saxlanıldı [hh:mm]" / "Xəta baş verdi ↻" — 11/500 muted, card footer + header.