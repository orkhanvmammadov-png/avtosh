# AXIN edit mode
Differences from NEW-listing mode ONLY — six-stage order, controls, autosave, validation all unchanged (O.10/O.11 sealed).
- Header: "Elanı redaktə et · X/6" (never "Elan yerləşdir").
- One context strip under the header (tinted, 11.5/1.5) — never per-screen banners:
  - ACTIVE: "Dəyişikliklər moderasiyadan sonra elanda görünəcək. Bu müddətdə mövcud elanınız aktiv qalacaq." (green tint #EDF4F0)
  - DEACTIVATED: "Elan hazırda deaktivdir. Dəyişikliklər təsdiqləndikdən sonra onu aktivləşdirə bilərsiniz."
  - DEACTIVATED + reactivation requested: "Elan dəyişikliklər təsdiqləndikdən sonra aktivləşdiriləcək."
  - EXPIRED: "Elanın müddəti bitib. Əvvəlcə dəyişiklikləri təsdiq üçün göndərin. Təsdiqdən sonra 2 AZN ödəməklə elanı yeniləyə bilərsiniz." (amber tint #FBEED8)
- Data prefilled from the edit revision; "Redaktəni ləğv et" ghost under the sticky primary (see 05).
- No payment CTA inside any edit stage; renewal lives outside the wizard.

## Review step (stage 6)
O.10 Review layout unchanged. CTA mapping: ACTIVE edit → "Dəyişiklikləri moderasiyaya göndər" · DEACTIVATED reactivation flow → "Dəyişiklikləri moderasiyaya göndər və aktivləşdir" · EXPIRED edit → "Dəyişiklikləri moderasiyaya göndər". No listing fee line (edits are free); no renewal payment inside wizard.

## Read-only pending view ("Redaktəyə bax")
State bar "Moderasiya gözləyir · göndərilib: <date>" (date only if API supplies submittedAt; no moderator ETA ever). All fields rendered read-only; no save/submit/cancel controls. References: axin/o12-pending-readonly.png.

## Correction required
Moderator reason displayed at top of the edit flow, explicitly scoped to the REDAKTƏ ("Redaktəyə düzəliş tələb olunur") — the approved public listing is conceptually separate and stays live if ACTIVE. CTA "Düzəliş et" continues the SAME revision. Existing correction-banner pattern reused.