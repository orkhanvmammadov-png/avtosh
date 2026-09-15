# Accessibility
- Search input labelled ("Təchizat axtar"); results change announced via aria-live polite ("n qrup, m seçim tapıldı").
- Group rows are <button aria-expanded aria-controls>; Enter/Space toggle; arrow keys move between options per native checkbox semantics.
- Options are native <input type="checkbox"> + <label>; no nested interactive controls inside rows.
- Counts rendered as text (pills carry words, not color alone); selected state = check + weight + color.
- Focus: 2px #147A4E ring, offset 2, on search, group buttons, checkboxes, expand links.
- Touch: ≥44px rows @390; expand/clear links ≥44px hit area.
- Detail expand is a button with real count; expanded/collapsed announced.