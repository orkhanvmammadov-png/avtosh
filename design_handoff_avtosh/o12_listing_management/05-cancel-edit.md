# Cancel edit
Availability: EDIT_DRAFT and CORRECTION_REQUIRED only. NEVER in PENDING_MODERATION (action absent, not disabled).
Label: "Redaktəni ləğv et" — ghost/low-priority text action under the sticky primary in the wizard (and Review); never competes with Davam et/submit.
Confirmation: title "Redaktəni ləğv etmək istəyirsiniz?" · body "Saxlanılmış dəyişikliklər silinəcək və mövcud təsdiqlənmiş elan dəyişməyəcək." · confirm = outlined danger "Redaktəni ləğv et" (destructive to the draft only — not filled red) · secondary "Geri qayıt". 390: bottom sheet.
Consequences: approved public content untouched; nothing published; history retained; any linked reactivation intent cleared. Success toast: "Redaktə ləğv edildi"; returns to My Listings. Reference: axin/o12-cancel-confirm.png.