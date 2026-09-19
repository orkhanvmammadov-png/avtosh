# Moderator edit mode
Entry: "Redaktə et" (review header). One lightweight green context strip: "Moderator redaktə rejimi — dəyişikliklər satıcının müraciətini dəyişmir və dərc olunmur" — no heavy warning banners, shown once at top.
Controls: seller-domain field controls in place (price/mileage numeric, catalog selects, O.11 equipment selector, photo plan) — no lifecycle/payment controls anywhere.
Actions: "Yadda saxla" (primary green) saves the private working adjustment ONLY — never implies approval/publication; "Dəyişiklikləri ləğv et" (ghost) abandons unsaved local changes and returns to saved review state (not a moderation decision).
While unsaved changes exist: decision buttons visible but not actionable (40% opacity, aria-disabled + reason text). Save → return to review → decisions unlock.
## Saved adjustment state
Chip "Moderator düzəlişi saxlanılıb" + attribution "Saxlayan moderator: <name> · <timestamp>" (+ note: saxlanılıb ≠ təsdiqlənib/dərc edilib). Adjustment revision is internal — never shown as raw metadata. Saved adjustment remains private until approval.
## Dependent-field UX
Changing category/brand/model shows a pre-save consequence warning listing what resets (e.g. "Model, ban növü və təchizat seçimləri sıfırlanacaq") — no silent clearing, moderator confirms before values drop.
## Unsaved-changes protection
Leaving edit mode with local changes → accessible dialog "Saxlanmamış dəyişikliklər var" / body "Redaktə rejimindən çıxsanız, saxlanmamış dəyişikliklər itəcək." / actions "Redaktəyə qayıt" (default) · "Dəyişiklikləri at" (outlined danger). No silent discard, no autosave.