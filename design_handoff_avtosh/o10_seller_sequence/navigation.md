# Navigation contract
## Primary forward (NEW listing)
"Davam et" ALWAYS opens the next sequential stage: 1→2→3→4→5→6. "Next-incomplete" auto-navigation is PROHIBITED for the primary CTA. Optional stages are never auto-skipped: after valid Quick Start the next screen is Detallar, always — even though its fields are optional.
## Backward
Dəyiş on any visited section (or its header) reopens it in place. Journey position (header chip) stays at the furthest reached stage. The reopened section's "Davam et" returns forward without re-traversing intermediate stages. Returning via Dəyiş alters no business data by itself.
## Blocking
Forward navigation blocks only per validation.md (required data of the CURRENT stage). Future sections are non-interactive until reached.
## Focus
On stage change, focus moves to the new stage heading; aria-live announces "Mərhələ X / 6 — <stage name>". No scroll jumps.
## Correction mode
Entry may deep-link directly to the flagged section (see audit-dependent.md item 3); this never reintroduces skipping into the NEW journey.