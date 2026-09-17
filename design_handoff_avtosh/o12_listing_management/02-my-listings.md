# My Listings card contract
Extends the existing O.10 status-card language — page not redesigned. Primary status pill stays authoritative (an ACTIVE listing with pending edit is NEVER shown as "in moderation" at card level); edit lifecycle rides as a SECONDARY chip next to the pill.
- Pills: Aktiv (#E7F2EC/#0F6440) · Deaktiv (#EDEBE4/#565B63) · Müddəti bitib (#FBEED8/#9A5B06). Chips: neutral green tint default; moderation gray; correction amber; approved green. All 10.5/600, r999.
- Button hierarchy: one green primary (.btnP2) per card, outline secondaries, "Deaktiv et" always ghost — never visually equal to Redaktə et. Premium/Boost entry points unchanged where applicable.
- Deactivated cards: thumbnail 55% opacity, price secondary color, meta "Platformada görünmür · müddət davam edir". No public Elana bax.
- DEACTIVATED+PENDING after request: status line "Moderasiya sonrası aktivləşəcək" replaces the button — never a live-looking disabled Aktiv et.
- Mobile (390): cards 1-col, actions wrap, every action ≥44px; ghost action last.
References: references/seller/o12-card-*.png (10 states).

## Deactivate confirmation
Title "Elanı deaktiv etmək istoyirsiniz?" — exact copy per 09-copy.md: body 3 lines (görünməyəcək / 30 günlük müddət dayanmayacaq / Premium-Boost dayanmayacaq). Primary "Deaktiv et" = navy (.btnN) — reversible, NOT danger red; secondary "Ləğv et". Desktop: centered dialog, focus to title, Esc/backdrop closes, focus returns to trigger. 390: bottom sheet, stacked full-width buttons (primary top). 60-second cache SLA is NOT surfaced in customer copy. References: seller/o12-deactivate-confirm.png, mobile/o12-390-deactivate-sheet.png.