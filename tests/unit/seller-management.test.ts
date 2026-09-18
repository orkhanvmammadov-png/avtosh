import { describe, expect, it } from "vitest";
import { deriveOwnerManagement, type OwnerManagementInput } from "@/lib/seller/management";

/** O.12 Stage B — server-authoritative derived seller state matrix. */

const NOW = Date.parse("2026-09-18T12:00:00Z");
const FUTURE = "2026-10-01T12:00:00.000Z";
const PAST = "2026-09-01T12:00:00.000Z";

function derive(input: Partial<OwnerManagementInput>) {
  return deriveOwnerManagement(
    {
      status: "ACTIVE",
      currentExpiresAt: FUTURE,
      sellerDeactivatedAt: null,
      reactivationRequested: false,
      editStatus: null,
      ...input,
    },
    NOW,
  );
}

describe("deriveOwnerManagement — sealed precedence and capabilities", () => {
  it("ACTIVE valid", () => {
    const m = derive({});
    expect(m.primary).toBe("ACTIVE");
    expect(m.canDeactivate).toBe(true);
    expect(m.canReactivate).toBe(false);
    expect(m.canEdit).toBe(true);
  });

  it("ACTIVE + edit draft/pending/correction stays primarily ACTIVE (secondary edit state)", () => {
    for (const editStatus of ["EDIT_DRAFT", "PENDING_MODERATION", "CORRECTION_REQUIRED"] as const) {
      const m = derive({ editStatus });
      expect(m.primary).toBe("ACTIVE");
      expect(m.editStatus).toBe(editStatus);
      expect(m.canDeactivate).toBe(true); // pending edit never blocks deactivation
    }
  });

  it("DEACTIVATED valid: primary DEACTIVATED, activate affordance on", () => {
    const m = derive({ sellerDeactivatedAt: PAST });
    expect(m.primary).toBe("DEACTIVATED");
    expect(m.canDeactivate).toBe(false);
    expect(m.canReactivate).toBe(true);
    expect(m.awaitingActivation).toBe(false);
  });

  it("DEACTIVATED + draft/pending/correction keeps the affordance until a request exists", () => {
    for (const editStatus of ["EDIT_DRAFT", "PENDING_MODERATION", "CORRECTION_REQUIRED"] as const) {
      const m = derive({ sellerDeactivatedAt: PAST, editStatus });
      expect(m.primary).toBe("DEACTIVATED");
      expect(m.canReactivate).toBe(true);
      expect(m.awaitingActivation).toBe(false);
    }
  });

  it("DEACTIVATED + PENDING/CORRECTION + requested → awaiting line replaces the button", () => {
    for (const editStatus of ["PENDING_MODERATION", "CORRECTION_REQUIRED"] as const) {
      const m = derive({ sellerDeactivatedAt: PAST, reactivationRequested: true, editStatus });
      expect(m.primary).toBe("DEACTIVATED");
      expect(m.canReactivate).toBe(false); // never a live-looking enabled Aktiv et
      expect(m.awaitingActivation).toBe(true);
    }
  });

  it("EXPIRED beats DEACTIVATED in primary classification", () => {
    const m = derive({ status: "EXPIRED", sellerDeactivatedAt: PAST, currentExpiresAt: PAST });
    expect(m.primary).toBe("EXPIRED");
    expect(m.canDeactivate).toBe(false);
    expect(m.canReactivate).toBe(false); // renewal path, not Aktiv et
  });

  it("effective expiry (ACTIVE past deadline, job lagging) presents as EXPIRED", () => {
    const m = derive({ currentExpiresAt: PAST });
    expect(m.primary).toBe("EXPIRED");
    expect(m.effectiveExpired).toBe(true);
    const deactivatedToo = derive({ currentExpiresAt: PAST, sellerDeactivatedAt: PAST });
    expect(deactivatedToo.primary).toBe("EXPIRED"); // never masks renewal
  });

  it("EXPIRED + edit states carry the secondary chip incl. approved-awaiting-renewal", () => {
    for (const editStatus of ["EDIT_DRAFT", "PENDING_MODERATION", "APPROVED"] as const) {
      const m = derive({ status: "EXPIRED", currentExpiresAt: PAST, editStatus });
      expect(m.primary).toBe("EXPIRED");
      expect(m.editStatus).toBe(editStatus);
    }
  });

  it("SUSPENDED and SOLD outrank everything and expose no lifecycle actions", () => {
    for (const status of ["SUSPENDED", "SOLD"] as const) {
      const m = derive({ status, sellerDeactivatedAt: PAST });
      expect(m.primary).toBe(status);
      expect(m.canDeactivate).toBe(false);
      expect(m.canReactivate).toBe(false);
      expect(m.canEdit).toBe(false);
    }
  });

  it("pre-publication statuses stay outside the O.12 management surface", () => {
    for (const status of ["DRAFT", "PENDING_MODERATION", "CORRECTION_REQUIRED", "REJECTED"]) {
      const m = derive({ status, currentExpiresAt: null });
      expect(m.primary).toBe("PRE_PUBLICATION");
      expect(m.canDeactivate).toBe(false);
      expect(m.canReactivate).toBe(false);
    }
  });
});
