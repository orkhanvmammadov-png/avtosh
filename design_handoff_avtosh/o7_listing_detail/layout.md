# Layout — Direction 1A (SƏHNƏ)

## 1440 (canonical)
- Container: full-bleed navy stage; content max 1360, gutter 40.
- Header: navy #141A22, h56, brand left, breadcrumb right (12/400 #7E8794).
- Stage: CSS grid `1fr 400px`, gap 28, padding 6px 40px 30px, background #141A22.
  - Gallery column: hero 16:10, radius 12; thumbnail row margin-top 8, grid `repeat(6,1fr)` gap 8, tiles 4:3 radius 8 (navy-raised #1D2733, border #2B3644).
  - Identity panel: 400px, background #1D2733, border 1px #2B3644, radius 12, padding 20. Order: badges+favorite row → price → Kredit/Barter chips → title → meta → CTA → seller → footer row (ref+report).
- Lower page: paper #F5F4F0, padding 24px 40px, grid `1fr 1fr` gap 16.
  - Left panel: key-spec tiles `repeat(3,1fr)` gap 8 → hairline → detailed specs 2-col (AVTOMOBİL / TEXNİKİ), col-gap 32.
  - Right: condition+features panel, then description panel (margin-top 16).
- Panels: white, border #E3E0D8, radius 10, padding 16px 18px. Section heading 14.5/700.

## 1024
- Same architecture. Panel 400→340, gap 28→20, gutter 40→32. Hero stays 16:10; thumbs 6-up. Panel paddings 20→16; price 34→28 Condensed; CTA h44 (13/600, padding 12). Title never wraps mid-word — meta line carries overflow. Lower page identical 2-col.

## 768
- Material transition: gallery full-width (16:10) → thumbnails 8-up (gap 6, "+n" on last tile) → identity board full-width (#1D2733, radius 12, padding 16; grid `1fr auto`: price+title left, CTA (h44, padding 12 22) + favorite 42px right) → lower content single column, gutter 24, order: key specs → condition/features → description → seller.

## 390
- Gutter 16. Navy block: top bar (back / brand / favorite 34px) → swipe gallery 4:3 full-bleed (counter chip bottom-right, segment progress bottom-left) → identity block padding 12px 16px 16px: badges → price 26 Condensed → Kredit/Barter chips (wrap) → title 15/600 → meta 12/400 #A7ADB8.
- Paper content: key specs 2-col tiles (gap 7) → condition chips → clamped description ("Daha çox ▾") → seller row (avatar 32, name/meta, "Şikayət et" right).
- Sticky contact bar: white, border-top #E3E0D8, shadow 0 -1px 2px rgba(20,26,34,.06); phone CTA flex:1 h48 + favorite 48×48; padding 10 14 + safe-area-inset-bottom; content bottom offset 72px. No horizontal overflow anywhere.