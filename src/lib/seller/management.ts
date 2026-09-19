/**
 * O.12 seller-management derived state — ONE server-side derivation so
 * React never re-implements lifecycle eligibility. Pure and
 * deterministic (`now` injectable for tests).
 *
 * Sealed precedence for the PRIMARY seller-visible state:
 *   DELETED > SUSPENDED > SOLD > EXPIRED > DEACTIVATED > ACTIVE
 * (DELETED never reaches the read model; expiry counts when status is
 * EXPIRED or the deadline has passed before the job caught up.)
 * The edit revision is always SECONDARY state — an ACTIVE listing with
 * a pending edit stays primarily Aktiv.
 */

export type OwnerPrimaryState =
  | "SUSPENDED"
  | "SOLD"
  | "EXPIRED"
  | "DEACTIVATED"
  | "ACTIVE"
  | "PRE_PUBLICATION";

export type OwnerEditState =
  | "EDIT_DRAFT"
  | "PENDING_MODERATION"
  | "CORRECTION_REQUIRED"
  | "APPROVED"
  | null;

export interface OwnerManagementInput {
  status: string;
  currentExpiresAt: string | null;
  sellerDeactivatedAt: string | null;
  reactivationRequested: boolean;
  editStatus: OwnerEditState;
}

/** Which edit affordance the card renders (Stage C — one per card):
    EDIT starts/continues via create-or-get, CONTINUE/FIX resume the
    open revision, VIEW is the read-only pending view. */
export type OwnerEditAction = "EDIT" | "CONTINUE" | "VIEW" | "FIX" | null;

/** Renewal affordance for EXPIRED listings: HIDDEN while an open edit
    makes renewal the wrong next step (sealed order: edit → moderation
    → renewal); RENEW_ACTIVATE after an APPROVED edit. */
export type OwnerRenewalAction = "RENEW" | "RENEW_ACTIVATE" | "HIDDEN" | null;

export interface OwnerManagement {
  primary: OwnerPrimaryState;
  /** True when status is still ACTIVE but the deadline already passed
      (expiry-job lag) — presented as EXPIRED, never as ACTIVE. */
  effectiveExpired: boolean;
  sellerDeactivated: boolean;
  reactivationRequested: boolean;
  editStatus: OwnerEditState;
  /** Server-authoritative capabilities (the HTTP layer re-enforces
      ownership/active-user; these drive UI affordances only). */
  canEdit: boolean;
  canDeactivate: boolean;
  /** Direct or routed "Aktiv et" affordance is meaningful. */
  canReactivate: boolean;
  /** DEACTIVATED + open moderation + request recorded — show the
      "Moderasiya sonrası aktivləşəcək" line instead of a button. */
  awaitingActivation: boolean;
  editAction: OwnerEditAction;
  renewal: OwnerRenewalAction;
}

export function deriveOwnerManagement(
  input: OwnerManagementInput,
  now: number = Date.now(),
): OwnerManagement {
  const deactivated = input.sellerDeactivatedAt !== null;
  const timeExpired =
    input.currentExpiresAt !== null && new Date(input.currentExpiresAt).getTime() <= now;
  const effectiveExpired = input.status === "ACTIVE" && timeExpired;

  let primary: OwnerPrimaryState;
  if (input.status === "SUSPENDED") primary = "SUSPENDED";
  else if (input.status === "SOLD") primary = "SOLD";
  else if (input.status === "EXPIRED" || effectiveExpired) primary = "EXPIRED";
  else if (input.status === "ACTIVE" && deactivated) primary = "DEACTIVATED";
  else if (input.status === "ACTIVE") primary = "ACTIVE";
  else primary = "PRE_PUBLICATION";

  const openEdit =
    input.editStatus === "EDIT_DRAFT" ||
    input.editStatus === "PENDING_MODERATION" ||
    input.editStatus === "CORRECTION_REQUIRED";

  // published-lifecycle editing (ACTIVE/EXPIRED incl. deactivated) —
  // pre-publication keeps the wizard
  const canEdit = primary === "ACTIVE" || primary === "DEACTIVATED" || primary === "EXPIRED";

  // ONE edit affordance per card (01-state-matrix.md): a terminal
  // APPROVED/REJECTED revision never resumes — a fresh edit starts
  // through create-or-get when the lifecycle permits it.
  const editAction: OwnerEditAction = !canEdit
    ? null
    : input.editStatus === "EDIT_DRAFT"
      ? "CONTINUE"
      : input.editStatus === "PENDING_MODERATION"
        ? "VIEW"
        : input.editStatus === "CORRECTION_REQUIRED"
          ? "FIX"
          : "EDIT";

  // Renewal for EXPIRED listings: sealed order is edit → moderation →
  // renewal, so an open edit hides the renewal CTA; an APPROVED edit
  // upgrades it to the combined renew-and-activate entry.
  const renewal: OwnerRenewalAction =
    primary !== "EXPIRED"
      ? null
      : openEdit
        ? "HIDDEN"
        : input.editStatus === "APPROVED"
          ? "RENEW_ACTIVATE"
          : "RENEW";

  return {
    primary,
    effectiveExpired,
    sellerDeactivated: deactivated,
    reactivationRequested: input.reactivationRequested,
    editStatus: input.editStatus,
    canEdit,
    canDeactivate: primary === "ACTIVE",
    // 01-state-matrix.md: DEACTIVATED+CORRECTION shows only Düzəliş et
    // (activation flows through fix → resubmit → approval; a direct
    // Aktiv et there would mislead), and a recorded request always
    // replaces the button.
    canReactivate:
      primary === "DEACTIVATED" &&
      !input.reactivationRequested &&
      input.editStatus !== "CORRECTION_REQUIRED",
    awaitingActivation:
      primary === "DEACTIVATED" && input.reactivationRequested && openEdit,
    editAction,
    renewal,
  };
}
