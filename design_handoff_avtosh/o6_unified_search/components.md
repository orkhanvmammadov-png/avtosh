# Components

## Unified search card (results mode)
Same component as Home 1C. Differences in results mode only: (a) compact + advanced controls render restored from the active query; (b) collapsed toggle shows the "n filtr" count chip (derived from applied filters); (c) applying collapses the panel (see interactions.md). Visual spec of every control: sealed O.2 components.md — unchanged.

## Active filter chip
Pill: h30 (28 @≤768), padding 0 6 0 11, bg #FFFFFF, border 1px #C6C2B6, r999, text 12/500 #1B1E24 (11.5 @≤768). Remove target: 18px circle, ✕ 11/600 #8A8F98; hover bg #F9E4E1 / #B3261E. Chip hover: border #8A8F98. One chip per applied criterion; ranges join as "2022–2026", "30 000–70 000 AZN". "Təmizlə" ghost (12/600 #147A4E) ends the row. Chips wrap — never horizontal scroll.

## Sort
Closed: h36 (32 @≤1024), bg #fff, border #C6C2B6, r6, 12.5/500, "Sırala: <option>" + chevron. Open: green border, panel = multi-select panel geometry (r8, overlay shadow, rows h34, active row #F5F4F0 + green ✓). Options = existing product sort contract only. Placement: right end of chips toolbar (all widths); at 390 it sits beside the Ətraflı toggle in the row under the header.

## Boost badge
Chip on card image, top-left: bg #E7F2EC, text #0F6440, 9/600 ls+4%, padding 3 7, r5, leading Lucide zap 9 (2.6 stroke). Label always "BOOST".

## Premium badge
bg #141A22, text #D9B45B, 9/600 ls+6%, padding 3 7, r5, label "PREMIUM".

## Premium + Boost
Both chips side by side, gap 4, Premium first, Boost collapses to zap-only glyph chip. Max 2 badges per card; card anatomy/layout never changes for promoted listings; favorite stays top-right.

## Listing card
Approved R.2/J card verbatim (16:11 frameless photo — 16:10 1-up @390, price+freshness row, model, spec line). Not redesigned by O.6.

## Load more
"Daha çox göstər" — secondary button (bg #fff, border #C6C2B6, r6, 13/600; hover green border/text). Full-width @390. No numbered pagination.