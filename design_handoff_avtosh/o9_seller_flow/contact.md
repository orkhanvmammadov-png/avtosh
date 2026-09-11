# ƏLAQƏ MƏLUMATLARI (sealed section)
Position: after Əlavə məlumat, before Baxış. Intro copy: "Bu elanda alıcılar sizinlə necə əlaqə saxlasın? Bu məlumat alıcıların sizinlə əlaqə saxlaması üçün istifadə olunacaq. Giriş nömrənizə təsir etmir."
## Satıcının adı
Label + "· elanda görünür". States: prefilled (dark text + note "profilinizdən gətirilib — dəyişə bilərsiniz" — the editability claim itself is AUDIT DEPENDENT), manually entered, missing (placeholder "Ad daxil edin" — placeholder gray vs value dark, never ambiguous), error ("Ad mütləqdir"). No seller type/verification.
## Əlaqə nömrəsi
+994 fixed prefix segment (soft fill, left-attached) + local 9-digit entry displayed grouped "10 218 41 91"; inputmode="tel"; helper "yerli formatda yazın — 010 218 41 91". States: prefilled, incomplete, invalid, missing (blocks section), valid. Demo numbers are illustrations only — never implementation constants. E.164 never shown to the seller.
## Secondary number — AUDIT DEPENDENT
"+ Digər nömrə əlavə et" dashed chip + amber "TEXNİKİ AUDİT TƏLƏB OLUNUR" chip. NOT implementation-authorized until Claude Code proves the listing/contact DTO + reveal endpoint support multiple numbers. If single-number contract: hide the affordance entirely — flow is complete with one phone.
## Auth vs listing contact
Conceptually separate; editing listing contact must never mutate account/login phone. Actual data source, per-listing editability, and draft persistence of both fields are AUDIT DEPENDENT.
## WhatsApp
No separate field; note only that existing WhatsApp contact derives from this number per current contract.
## Review block
ƏLAQƏ card: label caps 10.5/600 muted, name 12.5/600, phone friendly format, Dəyiş right. Present at all widths.