# O.9 → O.10 delta
- 7 sections → 6 stages (Əlavə məlumat + Əlaqə məlumatları merged into stage 5).
- Primary forward navigation: "next incomplete section" → strictly sequential next stage; optional stages (Detallar) always visited, never auto-skipped.
- Completion semantics: optional-empty sections no longer auto-marked complete → ✓ now means visited/acknowledged; new needs-attention state for visited-but-invalid.
- Progress: "n / 7 tamam" (deprecated) → "Mərhələ X / 6" journey position.
- CTA wording: mixed "Bölməni tamamla" → standardized "Davam et" on stages 1–5; final stage only "Elanı yerləşdir" / "Yenidən göndər".
- Correction/resubmit: documented as a separate lifecycle mode with deep-link entry (audit-dependent), leaving the NEW-listing sequence intact.
Everything else (fields, controls, photos, contact, fee, promotions, responsive geometry) unchanged from sealed O.9.