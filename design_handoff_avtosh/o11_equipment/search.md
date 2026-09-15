# Equipment search
- Field: inside the open selector, placeholder "Təchizat axtar...", search icon left, "✕ Təmizlə" appears when non-empty. Filters equipment ONLY — never submits marketplace search.
- Empty query: normal accordion behavior.
- Active query: matching groups auto-revealed (expanded), zero-match groups hidden entirely, match substring highlighted (#FBEED8), group headers + count pills remain for context, selection state untouched.
- No results: centered "Heç nə tapılmadı" + hint + "Axtarışı təmizlə" secondary button.
- Clear (✕, Escape, or emptying the field): restores the pre-search disclosure state.
- Matching is AZ-normalized (isofix / kamera / oturacaq / CarPlay); normalization algorithm is implementation-side, not a design contract.