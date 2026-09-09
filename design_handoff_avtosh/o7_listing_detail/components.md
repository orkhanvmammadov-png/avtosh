# Components

## Gallery
- Hero: 16:10 (4:3 @390), object-fit cover, radius 12 (0 @390 full-bleed). Counter chip "n / N" bottom-right: rgba(20,26,34,.8), white 10.5/500, padding 3 8, r5.
- Arrows: 34px circles rgba(255,255,255,.92), shadow sm, ‹ › 15/600 ink; hidden @390 (swipe).
- Thumbnails: 4:3, r8, 6 visible @1440/1024 (8 @768); selected = 2px #2FAE74 outline, offset 1; 6th/8th tile shows "+n" scrim rgba(20,26,34,.6) white 12/600 when more images exist.
- Image counts: 1 image → thumb row hidden, arrows hidden; 2–6 → real tiles only, no "+n"; many → "+n" tile. Missing/broken → camera-off placeholder tile (R.2 image system). Ratios fixed — zero layout shift.
- Fullscreen: presentation layer only over the existing image set (swipe/arrow navigation, same counter). No new image API.

## Identity panel (1440/1024) · identity board (768) · identity block (390)
Fields: badges, favorite, price, Kredit/Barter (passive attribute chips — outline #2B3644, text #A7ADB8 11/500, r999, padding 4 10; render only when attribute true), title "Brand Model, Year" 17/600 white, meta "km · fuel · city · freshness" 12.5/400 #A7ADB8, CTA, seller, footer "Elan № … · date" + report. No invented metadata.

## Price
34/700 Fira Sans Condensed white (28 @1024, 27 @768, 26 @390), unit "AZN" 14/600 #7E8794, white-space nowrap. SOLD/EXPIRED: color drops to #A7ADB8 (secondary), never struck through.

## Badges (PREMIUM / BOOST)
Navy-stage variant: PREMIUM = #1D2733 fill, 1px #4A4636 border, #D9B45B text 9.5/600 ls+6%, padding 3 7, r5. BOOST = #E7F2EC fill, #0F6440 text 9.5/600, zap icon 9px. Order: PREMIUM then BOOST, gap 5, top-left of panel; both full words in dual state; wrap allowed @390. States: none (no chips) / Premium / Boost / both. Never "Reklam/Sponsored/Promoted".

## Favorite
Square 34–38px (48 in sticky bar), r6, ♡ outline. On navy: border #2B3644, glyph #A7ADB8; hover border/glyph #2FAE74. On paper: border #C6C2B6, glyph #45413c. Selected: ♥ filled #B3261E on #F9E4E1, border #B3261E. Focus: 2px green ring. Always secondary to Contact.

## Key specs (CAR)
6 tiles: İl, Yürüş, Mühərrik, Yanacaq, Sürətlər qutusu, Ötürücü. Tile: #F5F4F0 (white+border on paper @390), r8, padding 9 11; label 10.5/400 #8A8F98, value 12.5/600. Grid: 3-up @1440/1024/768, 2-up @390. Missing value → tile omitted, grid reflows.
MOTORCYCLE: İl, Yürüş, Mühərrikin həcmi, Güc, Yanacaq, Rəng — CAR-only fields (Ban, Ötürücü, Vəziyyət) never rendered.

## Detailed specs
Groups AVTOMOBİL / TEXNİKİ; group title 11/600 ls+5% #8A8F98; rows label #565B63 / value 600 right-aligned, 12.5px, hairline #EDEBE4 separators, row padding 7 0. Missing field → row hidden (no "—"). 2 columns @1440/1024 (col-gap 32), single stacked @768/390.

## Condition claims
Pill chips: border #147A4E, text #0F6440 600, "✓ Vuruğu yoxdur" / "✓ Rənglənməyib" + adjacent disclaimer "satıcının bəyanı" 10.5/400 #8A8F98. Rendered only when claim present; section omitted when none. No verification implied.

## Features
Rows "✓ label" 12.5/400, check #147A4E 600, 2-col grid gap 7. Initial cap 8; "Bütün təchizatı göstər (n) ▾" 12/500 green expands in place; "Gizlət ▴" collapses.

## Description
Body 13/1.6 #45413c. Clamp 6 lines → "Daha çox ▾" green 600 → expands in place → "Daha az ▴". Short text never clamps.

## Contact CTA
Unrevealed: "Nömrəni göstər", #147A4E fill, white 14/600, h48 (h44 @1024/768), r6, full panel width; hover #189459 (navy panel) / #0F6440 (paper). Revealed: same button shows the phone number (existing reveal endpoint), pressed ground #0F6440; number is the tap-to-call action per current contract.

## Seller module
Avatar = initial circle 36 (#2B3644/#2FAE74 on navy; #EDEBE4/#147A4E on paper), name 13/600, meta "Fərdi satıcı · city" 11.5/400 muted. Gracefully single-line when data minimal. No ratings/verification/response fields.

## Report
"Şikayət et" 11/500 #D08A82 (navy) / #B3261E (paper), footer of panel or seller row; hover underline; never near CTA size.