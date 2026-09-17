# UI state dependencies (conceptual — no DB dictation beyond sealed O.12.2)
| Field (conceptual) | Consumed by |
| --- | --- |
| sellerDeactivatedAt | card pill Deaktiv; hides public Elana bax; edit-mode strip variant |
| reactivationRequested | "Moderasiya sonrası aktivləşəcək" line; hides Aktiv et; requested strip; Review CTA "…və aktivləşdir" |
| editRevision.id / status | secondary chip mapping; action set; read-only view; cancel availability (DRAFT/CORRECTION only) |
| editRevision.submittedAt | pending bar date (omit line if absent) |
| canEdit / canDeactivate / canReactivate | action visibility (server-authoritative; UI never enables what these deny) |
| listing.status + expiry | pill, renewal CTAs, expired hints |
| moderation reason/note | correction banner (edit-scoped) |
Error/conflict: deactivate/reactivate failure → existing error toast + retry; revision conflict / moderation changed in another session → "Elan başqa sessiyada dəyişdirilib. Səhifəni yeniləyin." (existing pattern); edit no longer available → same conflict pattern, return to My Listings.