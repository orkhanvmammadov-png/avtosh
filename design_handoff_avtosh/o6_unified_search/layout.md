# Layout — Results Page (all breakpoints)

## Shared vertical hierarchy (every width)
1 Site header (navy) → 2 Unified search card (white, r12, compact row + collapsible advanced area — the O.2 1C panel verbatim) → 3 Toolbar: active filter chips (left, wrapping) + Sort (right) → 4 Single results grid (boost-first) → 5 "Daha çox göstər". No sidebar, no Reklam section, no secondary grid.

## 1440
- Content max 1360, gutter 40. Search card: compact row grid `1fr 1fr 1fr 150px` gap 10 (Marka/Model/Şəhər/Axtar) + Ətraflı toggle row.
- Expanded advanced area: O.2 1440 recipe — `1fr 340px` (3-col specs + price spine), see sealed O.2 layout.md §1440.
- Toolbar: flex, space-between, margin 14 0 16; chips flex-wrap gap 7; Sort 36px flex:none.
- Grid: `repeat(4,1fr)` gap 18×16. First-view boost slots: 4 (existing policy), then organic — no separator.
- Load more: centered secondary button, margin 20 0 24.

## 1024
- Gutter 32. Compact row `1fr 1fr 1fr 130px` gap 9. Expanded: O.2 1024 recipe — 2-col specs + 300px spine.
- Grid `repeat(3,1fr)` gap 14; 3 boost slots. Chips wrap; Sort 32px.

## 768
- Gutter 24. Compact row `1fr 1fr 120px`. Expanded: O.2 768 recipe — 2-col specs, full-width price band (3px navy rule + #FBFAF8) at position 6, right-aligned Təmizlə/Axtar.
- Grid `repeat(3,1fr)` gap 12; 3 boost slots. Chips 28px, wrap.

## 390
- Gutter 14–16. Navy header carries the keyword search field. Toolbar row directly under header: Ətraflı toggle (+count chip) left, Sort right — always visible without scrolling into filters.
- Chips row wraps below the toolbar (28px chips).
- Expanded: O.2 390 recipe — inline single column (NOT a bottom sheet), h44 controls, price band, full-width Axtar h48 + centered Təmizlə.
- Grid: 1-up image-led cards (16:10); 2 boost slots first. Load more full-width. No horizontal overflow anywhere.

## Category contexts
- Avtomobillər: full CAR filter set (order 1–10 per O.2; Şəhər general).
- Motosikletlər: same shell; CAR-only fields (Ban növü, Ötürücü, Avtomobil vəziyyəti) omitted per existing catalog contract. Never force CAR controls into moto.

## Reading order
DOM order everywhere: search card → chips → sort → boosted cards → organic cards → load more. CSS must not reorder boost cards visually.