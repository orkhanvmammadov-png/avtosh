# API / state dependencies (conceptual — server-authoritative; no DB schema commands beyond sealed O.13.2)
Per field: currentApproved? · sellerSubmitted · moderatorAdjusted? · origin (seller|moderator) · editable · validation.
Adjustment (full working snapshot): id · revision (own counter) · status (working|terminal-discarded|terminal-decided) · savedBy · savedAt · submittedData + submittedImages (frozen at first save, NEW and EDIT alike) · adjustedData · imagePlan (see 06-photos) · subject identity · source listingRevision · source editRevisionId/editRevisionNo where applicable.
Subject: moderationType (NEW_LISTING|LISTING_EDIT) · listingRevision · editRevisionId · editRevisionNo.
Claim: ownedByCurrentModerator · owner · expiresAt.
Capabilities (server-authoritative; UI never enables what these deny): canEdit · canSave · canDiscardAdjustment · canApprove · canRequestCorrection · canReject. decisionsEnabled=false carries a reason string for the disabled state.
## Audit requirement (O.13.2 correction G)
Every adjustment save emits append-only MODERATION_ADJUSTMENT_SAVED: {adjustmentId, adjustmentRevision, actor, changedFields/deterministic delta, timestamp}. History reconstruction across claim takeovers must be possible; discard emits its own history event with original authorship intact.
## Invariants (B/D/E)
Working edits never mutate seller artifacts (listing content, listing_edit_revisions.data, listing_edit_images). Comparison base = frozen submitted snapshot, not live revision data.