# Decisions & history
Verbs unchanged: Təsdiqlə · Düzəliş tələb et · Rədd et — no new decision buttons.
Gating: unsaved local changes → decisions not actionable; after Yadda saxla (or cancel) → review state → decisions available.
Approve WITH adjustment: confirmation includes "Moderator düzəlişləri ilə təsdiqlənəcək" + concise changed-field list; approval applies the saved adjusted version. Approve WITHOUT adjustment: existing behavior/appearance unchanged — no added friction.
Correction with adjustment: dialog states "Moderator düzəlişləri tətbiq olunmayacaq. Satıcı düzəliş sorğusunu alacaq; saxlanılmış moderator düzəlişi tarixçəyə köçürüləcək." Seller never inherits moderator values; resubmission starts a CLEAN adjustment pass.
Reject with adjustment: "Moderator düzəlişləri tətbiq olunmayacaq" — normal lifecycle continues; adjustment terminal in history; for LISTING_EDIT the approved public version stays untouched.
History (compact list, not version control): events Seller təqdim etdi · Seller yenidən göndərdi · Moderator düzəlişi saxladı · Moderator düzəlişi sildi · Düzəliş tələb edildi · Rədd edildi · Təsdiqləndi — each with actor + timestamp. Discarded adjustments hidden from working view, visible in history. Backend field-delta metadata exists (audit) but UI stays compact.
## UX state matrix
| Subject | State | Summary | Edit entry | Decisions |
| --- | --- | --- | --- | --- |
| NEW | no adjustment | none | Redaktə et | active (plain approve) |
| NEW | editing-unsaved | live markers | in edit | LOCKED |
| NEW | saved adjustment | two-way + chip | Redaktə et (continue) | active (approve = adjusted, confirm text) |
| NEW | prev-moderator saved | takeover card first | Davam et / Düzəlişi sil | after choice |
| NEW | stale/conflict | conflict card | blocked | LOCKED until refresh |
| EDIT | no adjustment | seller two-way (O.12) | Redaktə et | active |
| EDIT | editing-unsaved | three-way live | in edit | LOCKED |
| EDIT | saved adjustment | three-way + chip | continue | active (adjusted approve) |
| EDIT | prev-moderator saved | takeover card | Davam et / sil | after choice |
| EDIT | stale/conflict | conflict card | blocked | LOCKED |
Outcomes: approve → adjusted (or plain) version becomes approved; correction → adjustment terminal, seller correction flow; reject → adjustment terminal, lifecycle reject.