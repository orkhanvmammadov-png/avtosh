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

  return {
    primary,
    effectiveExpired,
    sellerDeactivated: deactivated,
    reactivationRequested: input.reactivationRequested,
    editStatus: input.editStatus,
    // published-lifecycle editing (ACTIVE/EXPIRED incl. deactivated) —
    // Stage C exposes the navigation; pre-publication keeps the wizard
    canEdit: primary === "ACTIVE" || primary === "DEACTIVATED" || primary === "EXPIRED",
    canDeactivate: primary === "ACTIVE",
    canReactivate: primary === "DEACTIVATED" && !input.reactivationRequested,
    awaitingActivation:
      primary === "DEACTIVATED" && input.reactivationRequested && openEdit,
  };
}
