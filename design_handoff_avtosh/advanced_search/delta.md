# Priority, Current-Code Delta, Risks

## MUST MATCH
Reading order 1–10 in DOM · two-zone 1440/1024 layout with price spine (340/300px) · 768/390 price band recipe (navy rule + #FBFAF8) at position 6 · one closed-control geometry (h40/h44, #C6C2B6, r6, 13px) · Year≡Engine≡Price range parity · Kredit/Barter inside Price as aria-pressed toggles · one multi-select system (panel geometry, checkbox rows, stays-open, Təmizlə (n) footer, ✕ group clear) · swatch+label color options · Vəziyyət as visible final toggle pair · actions (Axtar primary in spine / full-width @390, Təmizlə ghost) · collapse preserves state · truncating "+n" summaries with fixed trigger height.

## SHOULD MATCH
Count chip on collapsed toggle (derived from existing state) · "Sıfırla" price-group reset · muted Min/Maks prefixes in filled price fields · Condensed numerals for price values · Rəng trigger swatch pair overlap · panel footer hint text · 240ms expand transition.

## POLISH
Chevron color/rotation on open · hover row tint · focused-row inner outline · helper line "Kredit və Barter qiymətə aiddir" · placeholder examples ("maks. 123 500").

## Current implementation — KEEP
Expand/collapse mechanics + inline push-down · URL-as-state incl. legacy singular params · multi-select open/close contract (outside, Esc, one-at-a-time, stays open on pick) · manual numeric inputs, no steppers · year/engine option generation · OR/AND semantics · category scoping · Back/Forward/reload behavior · Boost/ranking/pagination untouched.

## CHANGE
Layout → two-zone grid + spine (breakpoint sheets) · field grouping/spans per layout.md · Price presentation → spine/band treatment · control geometry unified to the spec (heights/borders/radius/typography) · multi-select trigger summaries → "A, B +n" + ✕ clear · Kredit/Barter → word-toggle recipe inside Price · Vəziyyət → toggle-pair presentation (checkbox semantics retained underneath) · actions relocated (spine / band-flow) · spacing/typography per tokens.md.

## REMOVE
Any prior per-filter boxes/cards, mismatched control heights, checkbox-row presentation of Kredit/Barter, price treatments superseded by 1C, decorative field icons not in the approved frames, any result-count text in the advanced area.

## Risks → expected outcome
- Responsive grid restructure (spine ↔ band): keep ONE component; move price block between grid areas via CSS grid-template-areas; DOM order stays 1–10.
- Multi-select overlay positioning: anchored popover, overlays card content, viewport-collision flip allowed; @390 trigger-width, max-height 60vh — never a modal/sheet.
- Mounted-hidden panels: if panels stay mounted for state, keep them inert (display:none/inert) so focus order and a11y tree stay clean.
- Price≡Engine parity: derive both from the same range component; parity is an acceptance check.
- Mobile overflow: all widths from grid tracks + min-width:0; test longest labels (Avtomat (Variator), Plug-İn Hibrid).
- Focus behavior: closing any panel returns focus to its trigger; Escape must not collapse the whole advanced section.
- Shared control reuse: if the app's Select/Input components are shared with Search Results, scope 1C styling to the Home advanced context.

## Ready for implementation?
YES — all §41 gate questions answered affirmatively in README; no unresolved visual blockers, no open design questions.