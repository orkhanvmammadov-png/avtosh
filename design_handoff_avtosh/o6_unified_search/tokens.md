# Tokens (delta over O.2/R.2 — no new palette)
All O.2/R.2 tokens apply unchanged. O.6 uses only existing values:
- Chip: surface-raised #FFFFFF, border-strong #C6C2B6, r999; remove-hover tint #F9E4E1 / #B3261E (status-danger pair).
- Boost badge: brand tint #E7F2EC / #0F6440 (existing promotion-boost tokens).
- Premium badge: #141A22 / #D9B45B (existing promotion-premium tokens).
- Sort control: standard control tokens at h36/h32.
- Grid gaps: 18×16 @1440 · 14 @1024 · 12 @768 · card stack 390 per R.2.
- Typography: Fira Sans throughout; chip 12/500; badge 9/600; toolbar per components.md.
- Focus: 2px #147A4E ring offset 2 on chips (removable = real buttons), sort trigger, load-more.
- Touch @390: chips ≥28px visual with ≥44px hit area on ✕ (padded target), sort h44 tap area, load-more h48.
- Motion: 240ms panel ease (optional), 150ms hover; nothing else animates.