# Continue rules (server remains authoritative for submission)
| Stage | Davam et enabled when |
| --- | --- |
| 1 Sürətli başlanğıc | existing required identity fields valid (Category/Brand/Model/Year) |
| 2 Detallar | ALWAYS — including fully empty (helper: "Boş buraxa bilərsiniz") |
| 3 Satış məlumatları | existing required sale fields valid (no new requirements invented) |
| 4 Şəkillər | current min-photo contract met (min 3); otherwise disabled CTA + amber note "Daha n şəkil lazımdır" |
| 5 Əlavə məlumat və əlaqə | Contact fields valid; Features/Description never block |
| 6 Baxış və dərc | existing submit/resubmit validation authoritative |
Errors: inline on blur (O.9 patterns), section-level needs-attention on revisit, no modals. UI guidance never replaces server validation for submission, resubmission, quota, payment, moderation.