# Seller equipment selector (Stage 5, subgroup ƏLAVƏ MƏLUMAT)
- Location: unchanged — Təchizat disclosure inside "Əlavə məlumat və əlaqə" (Mərhələ 5/6). No new journey stage. Optional: 0..n selections, no maximum, never blocks Davam et.
- Closed trigger: standard control row (h44 desktop / h48 @390), label "Təchizat" + summary — "Təchizat seçilməyib" (muted) or "n təchizat seçilib" / "n seçilib" @390 (green 600). Chevron right.
- Open: search field (h40 / h44 @390) → group list in one bordered container (r8): 7 accordion rows.
- Group row: h40 (≥44 @390), 12.5/600, chevron right, count pill "n seçilib" (#E7F2EC/#0F6440, r999) only when n>0; expanded row ground #F9F8F5, chevron rotated.
- Default disclosure: first group (Təhlükəsizlik) expanded, remaining 6 collapsed. Never all 7 auto-expanded.
- Options: native checkboxes, 12.5/400 rows (selected 600 green); 2-col grid ≥1024, 1-col ≤768/390 with rows ≥44px. Long groups @390 clamp at 5 rows + "Daha n seçim ▾".
- Totals: honest counts only — overall in the subgroup header + per-group pills. Zero groups show no pill.
- Hierarchy guard: selector never buries Təsvir or ƏLAQƏ MƏLUMATLARI — collapsed by default, and the open container scrolls internally past ~60vh @390.