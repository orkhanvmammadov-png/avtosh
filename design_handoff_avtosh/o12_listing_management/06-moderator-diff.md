# Moderator: queue + edit review
## Queue
Existing queue table + compact type tag column: YENİ ELAN (neutral #EDEBE4/#565B63) · ELAN REDAKTƏSİ (navy #141A22/#2FAE74), 8.5/600 caps. Density preserved; no separate portal; narrow widths let the tag wrap above the title. Reference: moderator/o12-mod-queue-tags.png.
## Edit review — changed-first model
Header "Dəyişikliklərin müqayisəsi" + legend "Mövcud elan → Təklif olunan dəyişiklik".
- Scalars/contact/seller_name: label · old (struck, muted) · → · new (green-tinted, 600). E.g. Qiymət 25 000 AZN → 24 500 AZN.
- Claims/booleans: explicit text "Yox → Bəli" / "Bəli → Yox" — never color-only.
- Equipment (O.11 names): "Əlavə edildi: + …" (green) / "Silindi: − …" (red) — never two full 58-item lists.
- Photos: thumbnail row with corner badges Əlavə edildi / Silindi (dimmed) / Yeni əsas şəkil; unchanged photos unbadged. No pixel diff.
- Description: two blocks ƏVVƏL (neutral) / SONRA (green tint); no character redline.
- Unchanged fields: collapsed behind "Digər məlumatlar (dəyişməyib) ▾".
## Decisions
Existing Təsdiqlə / Düzəliş tələb et / Rədd et with the current confirmation/reason model — no new verbs. Optional context line only when useful: deactivated → "Elan deaktivdir — təsdiqdən sonra yalnız aktivləşdirmə şərtləri ödənərsə yayımlanacaq."; expired → "Elanın müddəti bitib — təsdiq məzmunu yeniləyəcək, elan yenilənənədək yayımlanmayacaq." No backend field names in UI. References: moderator/o12-mod-diff-full.png, mobile/o12-390-mod-diff.png.