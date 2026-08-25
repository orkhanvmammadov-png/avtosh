"use client";

import { useState } from "react";
import { SELLER } from "@/lib/marketplace/labels";
import type { ListingEditor } from "@/components/seller/use-listing-editor";
import { Field, fieldClass, DeferredInput } from "@/components/seller/wizard-fields";

/** Step 4 — description and contact phone. */
export function DescriptionStep({ editor }: { editor: ListingEditor }) {
  const { dto } = editor;
  const [description, setDescription] = useState(dto.description ?? "");
  return (
    <div className="space-y-4">
      <Field label={SELLER.description} htmlFor="wizard-description" hint={SELLER.descriptionHint}>
        <textarea
          id="wizard-description"
          data-testid="wizard-description"
          className={`${fieldClass} min-h-40 py-3`}
          maxLength={5000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            editor.patch({ description: e.target.value.trim() === "" ? null : e.target.value });
          }}
        />
      </Field>
      <DeferredInput
        id="wizard-contact-phone"
        label={SELLER.contactPhone}
        hint={SELLER.contactPhoneHint}
        inputMode="tel"
        placeholder="+994501234567"
        maxLength={32}
        initialValue={dto.contactPhone ?? ""}
        onValue={(value) => editor.patch({ contact_phone: value.trim() === "" ? null : value.trim() })}
      />
    </div>
  );
}
