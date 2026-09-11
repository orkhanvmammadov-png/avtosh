# Validation
Field level (on blur): required empty → "… mütləqdir"; invalid phone → "Nömrə natamamdır — Azərbaycan nömrəsi 9 rəqəmdir"; invalid numeric → inline red border + message; stale Model impossible (auto-cleared on Brand change).
Section level: "Bölməni tamamla" blocked until required fields valid; incomplete section reopened shows red dot + first error focused. Photos: "n/3 minimum — daha X şəkil lazımdır" (amber until met, red on attempted completion); upload failure per-tile with retry.
Review level: any section with errors listed as needs-attention rows linking back; submit disabled only while blocking errors exist.
Server: submission failure → persistent section-level notice with retry; autosave failure → "Xəta baş verdi ↻" chip. No modals for validation anywhere.