# Listing Detail equipment (O.7 surface)
- Section "Təchizat" in the O.7 features panel position. Only seller-selected equipment renders, grouped by the same taxonomy; caps group labels (10/600 ls+7% muted); items "✓ label" (check #147A4E).
- Empty groups hidden; zero selections → section not rendered at all (current behavior preserved; no placeholders).
- Layout: 2-col group columns at 1440/1024 (O.7 panel), single column at 768/390.
- Large selections — SEALED PATTERN: ONE overall expand/collapse (never seven buyer accordions). ≤12 items: full grouped list, no control. >12: collapsed state shows the first two populated groups clamped (~5 items), then "Bütün təchizatı göstər (n) ▾" with the real count; "Gizlət ▴" collapses. The 12-item threshold and ~5-row clamp follow the approved O.11.3 references; exact clamp tuning is IMPLEMENTATION DETAIL within this interaction model. Rejected alternative: per-group toggles — 7 controls, more taps, uneven rhythm; documented, not delivered.
- "Digər" fallback group renders last when legacy features exist.
- 5 / 15 / 30+ selections validated in references (grouped, collapsed, expanded states).