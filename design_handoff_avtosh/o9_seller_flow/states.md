# States
## Lifecycle
- NEW listing: full flow, fee logic applies (free 1–3, 2 AZN 4th+), promo module shown.
- EDIT: same section UI prefilled from the LISTING (not profile); no fee line for edits per current contract; promo module per existing rules.
- CORRECTION / RESUBMIT: correction banner above section list (approved O.9 pattern); no new-listing fee re-trigger; promotion purchase does not repeat automatically.
Shared UI: all section cards. New-listing-only: quota/fee lines. Lifecycle-dependent: correction banner, promo module availability.
## System states
catalog loading (inline spinner) · model loading (disabled + spinner) · autosave 3 states · photo uploading/failed/retry · submit loading (button) · server error (section-level notice, no modal storm) · validation (see validation.md).
## Fee × promo examples (all captured in references/)
A Free + none · B Free + Premium · C 2 AZN + none · D 2 AZN + Premium+Boost. Fee line and promo pricing never merge into one total.