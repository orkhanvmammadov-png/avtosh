# Reactivation flows
A. Valid + no edit: "Aktiv et" → direct action (lightweight, no heavy confirm) → loading state on button → success toast "Elan aktivləşdirildi" → card becomes Aktiv. Failure: existing error toast + retry.
B. EDIT_DRAFT: "Aktiv et" → NO success, NO publication of old version → route into AXIN edit mode with notice "Elanı aktivləşdirmək üçün dəyişiklikləri tamamlayın və moderasiyaya göndərin." → context strip = requested variant → Review CTA "Dəyişiklikləri moderasiyaya göndər və aktivləşdir".
C. PENDING (no request yet): "Aktiv et" → records activation intent → listing stays hidden → card status becomes "Moderasiya sonrası aktivləşəcək", button removed.
D. CORRECTION_REQUIRED: route to correction; intent persists; copy explains reactivation happens only after correction → resubmit → approval.
E. REJECTED / CANCELLED edit: activation intent cleared; card returns to plain Deaktiv.
Invariant: no path reactivates unmoderated edited content; no path publishes the stale approved version while an edit revision is open.