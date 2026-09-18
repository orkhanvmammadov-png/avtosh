# Visual delta (before → after)
- My Listings: single-status cards → primary pill + secondary edit-lifecycle chip; new deactivated card treatment (dimmed thumb, no public view); expired cards gain edit-aware CTAs.
- AXIN: publish-only wizard → edit mode via header rename + one lifecycle context strip + ghost cancel; Review gains 2 CTA variants; zero structural change.
- Moderator: queue gains type tag; new-listing review unchanged; edit review adds changed-first diff panel (scalar/claim/equipment/photo/description) + optional lifecycle context line.
- Dialogs: 2 new confirmations (deactivate = navy reversible; cancel edit = outlined danger) on existing dialog/sheet patterns.
- Nothing else changed: O.7 public page, O.9–O.11 seller flow, promotion, payment, search all untouched.
## Sealed non-goals
No delete/restore · no SOLD seller management · no new payment UX · no new promotion UX · no chat · no moderator ETA · no version-history browser · no analytics UI · no notification center · no redesign of O.10/O.11/O.7.
## Handoff QA (verified)
All O.12.3 states represented (14 matrix rows + dialogs + toasts) · no state contradicts O.12.2 lifecycle · labels match 09-copy.md exactly · no action bypasses moderation · expired+edit is moderation-first · PENDING has no cancel · deactivated public view never implied · single wizard, single moderation system.