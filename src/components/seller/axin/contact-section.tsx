"use client";

import { useState } from "react";
import { formatAzLocalPhoneInput, formatAzPhoneForDisplay } from "@/components/auth/phone-format";
import { fieldClass } from "@/components/seller/wizard-fields";
import { SELLER } from "@/lib/marketplace/labels";
import type { ListingEditor } from "@/components/seller/use-listing-editor";

/**
 * O.9 ƏLAQƏ MƏLUMATLARI (contact.md): listing-level seller name +
 * primary contact phone. The phone is written ONLY to
 * listings.contact_phone_e164 through the normal revision-guarded
 * PATCH — users.phone_e164 / login identity are never touched. O.1
 * presentation helpers do the friendly local formatting; the server's
 * normalizePhoneE164 stays the single canonicalization authority.
 * Secondary phone is DEFERRED by Owner decision and fully absent.
 */

/** Client-side advisory validity — the server remains authoritative. */
function phoneLooksValid(display: string): boolean {
  const compact = display.replace(/[\s\-()]/g, "");
  return /^0\d{9}$/.test(compact) || /^\+\d{8,15}$/.test(compact);
}

export function ContactSection({
  editor,
  authPhoneE164,
  authDisplayName,
}: {
  editor: ListingEditor;
  authPhoneE164: string;
  authDisplayName: string | null;
}) {
  const { dto } = editor;
  // The name NEVER passively prefills: a displayed value must never
  // look like completed listing data while listings.seller_name is
  // still NULL. A real account display name is offered as an EXPLICIT
  // one-tap suggestion (like the login-phone chip) whose acceptance
  // persists through the normal revision-guarded PATCH.
  const [name, setName] = useState(dto.sellerName ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [phone, setPhone] = useState(
    dto.contactPhone === null ? "" : formatAzPhoneForDisplay(dto.contactPhone),
  );
  const [phoneError, setPhoneError] = useState<string | null>(null);

  function commitName(value: string) {
    editor.patch({ seller_name: value.trim() === "" ? null : value });
  }
  function commitPhone(value: string) {
    editor.patch({ contact_phone: value.trim() === "" ? null : value.trim() });
  }

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed text-slate-strong">{SELLER.contactIntro}</p>
      <div className="grid gap-x-3.5 gap-y-3 sm:grid-cols-2">
        <div>
          <label htmlFor="wizard-seller-name" className="mb-1 block text-xs font-medium text-slate-strong">
            {SELLER.sellerName}
            <span className="ml-1 font-normal text-muted">· {SELLER.sellerNameHint}</span>
          </label>
          <input
            id="wizard-seller-name"
            data-testid="wizard-seller-name"
            className={`${fieldClass} ${nameError !== null ? "border-danger" : ""}`}
            maxLength={100}
            placeholder={SELLER.sellerNamePlaceholder}
            value={name}
            aria-invalid={nameError !== null ? true : undefined}
            aria-describedby={nameError !== null ? "wizard-seller-name-error" : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
              commitName(e.target.value);
            }}
            onBlur={() => {
              if (name.trim() === "") {
                setNameError(SELLER.sellerNameRequired);
              }
            }}
          />
          {nameError !== null ? (
            <p role="alert" id="wizard-seller-name-error" className="mt-1 text-xs text-danger">
              {nameError}
            </p>
          ) : null}
          {dto.sellerName === null && authDisplayName !== null && name.trim() === "" ? (
            <button
              type="button"
              data-testid="contact-use-profile-name"
              className="mt-2 inline-flex h-9 items-center rounded-control border border-dashed border-line-strong px-3 text-[12px] font-medium text-ink transition-colors duration-150 hover:border-primary hover:text-primary"
              onClick={() => {
                // Explicit acceptance — the ONLY path from the account
                // name into listings.seller_name (normal PATCH).
                setName(authDisplayName);
                setNameError(null);
                editor.patch({ seller_name: authDisplayName }, { immediate: true });
              }}
            >
              {SELLER.useProfileName} {authDisplayName}
            </button>
          ) : null}
        </div>
        <div>
          <label htmlFor="wizard-contact-phone" className="mb-1 block text-xs font-medium text-slate-strong">
            {SELLER.contactPhone}
          </label>
          <input
            id="wizard-contact-phone"
            data-testid="wizard-contact-phone"
            className={`${fieldClass} ${phoneError !== null ? "border-danger" : ""}`}
            inputMode="tel"
            autoComplete="tel"
            maxLength={32}
            placeholder="010 218 41 91"
            value={phone}
            aria-invalid={phoneError !== null ? true : undefined}
            aria-describedby={phoneError !== null ? "wizard-contact-phone-error" : "wizard-contact-phone-hint"}
            onChange={(e) => {
              const formatted = formatAzLocalPhoneInput(e.target.value);
              setPhone(formatted);
              setPhoneError(null);
              commitPhone(formatted);
            }}
            onBlur={() => {
              if (phone.trim() !== "" && !phoneLooksValid(phone)) {
                setPhoneError(SELLER.contactPhoneIncomplete);
              }
            }}
          />
          {phoneError !== null ? (
            <p role="alert" id="wizard-contact-phone-error" className="mt-1 text-xs text-danger">
              {phoneError}
            </p>
          ) : (
            <p id="wizard-contact-phone-hint" className="mt-1 text-xs text-muted">
              {SELLER.contactPhoneLocalHint}
            </p>
          )}
          {dto.contactPhone === null && phone.trim() === "" ? (
            <button
              type="button"
              data-testid="contact-use-login-phone"
              className="mt-2 inline-flex h-9 items-center rounded-control border border-dashed border-line-strong px-3 text-[12px] font-medium text-ink transition-colors duration-150 hover:border-primary hover:text-primary"
              onClick={() => {
                // Explicit action — this is the only way the login
                // phone reaches the LISTING field (never on render).
                const display = formatAzPhoneForDisplay(authPhoneE164);
                setPhone(display);
                setPhoneError(null);
                editor.patch({ contact_phone: authPhoneE164 }, { immediate: true });
              }}
            >
              {SELLER.useLoginPhone} {formatAzPhoneForDisplay(authPhoneE164)}
            </button>
          ) : null}
          <p className="mt-2 text-[11.5px] text-muted">{SELLER.contactPhoneListingOnly}</p>
        </div>
      </div>
    </div>
  );
}
