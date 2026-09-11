# Interactions
- Section complete: "Bölməni tamamla" validates the open card → collapses to summary → next card opens. Earlier sections always reopenable via Dəyiş; completing again is non-destructive.
- Brand change → Model cleared + Model field focused. Category change → dependent sections reset per existing draft contract (confirm dialog only if data would be lost).
- Photo reorder: desktop drag; mobile long-press + drag; slot 1 = Əsas şəkil, chip moves instantly.
- Review Dəyiş → scrolls/opens the target section; return path back to review preserved.
- Submit: "Elanı dərc et" → existing submission path (free → moderation; 4th+ → existing 2 AZN payment path). Promo selection stored as intent only (see promotions.md).
## Mobile keyboard (390)
Brand/Model search: overlay keeps input pinned above keyboard, results scroll between. Price/Mileage: inputmode="numeric"; Phone: inputmode="tel"; Description: default keyboard. Sticky primary action stays above the keyboard and never covers the active field or its error; when the keyboard would overlap, the action bar yields (field + error scroll into view above it).
## Loading
Catalog/model loads are per-control; photo upload per-tile; submit shows loading state on the primary button only — never a full-page block.