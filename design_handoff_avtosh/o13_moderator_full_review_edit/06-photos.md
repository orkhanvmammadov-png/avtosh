# Photos — review + moderator photo plan
Review: complete gallery in submitted/proposed order, primary badged "Əsas", O.12 diff badges when applicable (Əlavə edildi/Silindi/Yeni əsas şəkil).
Edit (ModeratorPhotoPlan): remove ("Şəkli çıxar"), restore before save ("Geri qaytar" on the dimmed removed tile), reorder (drag on desktop, up/down controls at 390), set primary ("Əsas şəkil et", green outline on chosen). NO upload — no button, no dropzone; replacement photos require "Düzəliş tələb et".
Removal semantics: working-state proposal only — reversible until approval; copy never implies storage deletion.
Minimum validation: if plan leaves < minimum (3): save blocked with "Ən azı 3 şəkil qalmalıdır — yadda saxlamaq mümkün deyil" tied to the gallery; an approvable invalid gallery cannot be constructed.
## Image plan data contract (conceptual, per image)
sourceId (stable — not ephemeral DB row id) · storageId/path (backend-facing) · displayUrl · originalOrder · adjustedOrder · originalPrimary · adjustedPrimary · removed · origin (seller|current-approved).