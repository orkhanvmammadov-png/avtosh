"use client";

import { useState, type ReactNode } from "react";

/** Shared, accessible form primitives for the seller wizard. */

export const fieldClass =
  "min-h-12 w-full rounded-control border border-line-strong bg-raised px-3 text-base text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:shadow-[0_0_0_2px_rgba(20,122,78,0.25)] focus:outline-none disabled:bg-sunken disabled:text-muted disabled:hover:border-line-strong";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-strong">
        {label}
      </label>
      {children}
      {hint !== undefined ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error != null ? (
        <p role="alert" id={`${htmlFor}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  placeholder,
  disabled = false,
  items,
  valueField = "id",
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  placeholder: string;
  disabled?: boolean;
  items: { id: string; name: string; code?: string }[];
  /**
   * What each option submits (4.17O.4). Default "id": UUID-backed
   * fields (brand/model/city and every reference_options group) —
   * their PATCH contract is the catalog UUID. Only a caller whose API
   * contract genuinely is the catalog CODE (Category) opts into
   * "code"; the old implicit `code ?? id` fallback made the
   * reference-option selects submit codes the server rejects.
   */
  valueField?: "id" | "code";
  onChange: (value: string | null) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        data-testid={id}
        className={fieldClass}
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">{placeholder}</option>
        {items.map((item) => (
          <option key={item.id} value={valueField === "code" ? (item.code ?? item.id) : item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * Local-state text/number input that pushes debounced patches upward.
 * Local state keeps typing smooth; the wizard remounts fields (via
 * resetKey) whenever server state must win (conflict reload).
 */
export function DeferredInput({
  id,
  label,
  initialValue,
  hint,
  error,
  inputMode,
  placeholder,
  maxLength,
  inputClassName = "",
  onValue,
}: {
  id: string;
  label: string;
  initialValue: string;
  hint?: string;
  error?: string | null;
  inputMode?: "numeric" | "tel" | "text";
  placeholder?: string;
  maxLength?: number;
  /** Additive presentation classes (O.9 AXIN value styling). */
  inputClassName?: string;
  onValue: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <input
        id={id}
        data-testid={id}
        className={`${fieldClass} ${inputClassName}`}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={error != null ? true : undefined}
        aria-describedby={error != null ? `${id}-error` : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          onValue(e.target.value);
        }}
      />
    </Field>
  );
}

/**
 * Local-state checkbox that pushes patches upward (DeferredInput's
 * philosophy): the visible state flips instantly while the serialized
 * editor saves in the background; resetKey remounts adopt server
 * state after conflict recovery.
 */
export function DeferredCheckbox({
  id,
  label,
  initialChecked,
  onValue,
}: {
  id: string;
  label: string;
  initialChecked: boolean;
  onValue: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-line-strong bg-raised px-3 transition-colors duration-150 hover:border-primary">
      <input
        id={id}
        data-testid={id}
        type="checkbox"
        className="h-5 w-5 accent-primary"
        checked={checked}
        onChange={(e) => {
          setChecked(e.target.checked);
          onValue(e.target.checked);
        }}
      />
      <span className="text-sm font-medium text-ink">{label}</span>
    </label>
  );
}

/**
 * O.9 AXIN lightweight toggle chip (components.md Booleans): white
 * chip with the standard border, selected = green tint + green border
 * + ✓ prefix (non-color signal). Semantically a REAL checkbox — the
 * input is visually hidden but keeps native semantics and state
 * assertions; the label carries the visible chip and the click
 * target. Controlled variant.
 */
export function ChipToggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      data-testid={`${id}-chip`}
      className={`inline-flex h-10 cursor-pointer select-none items-center gap-1.5 rounded-control border px-3.5 text-[13px] font-medium transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40 ${
        checked
          ? "border-[#147A4E] bg-[#E7F2EC] text-[#147A4E]"
          : "border-line-strong bg-raised text-ink hover:border-muted"
      }`}
    >
      <input
        id={id}
        data-testid={id}
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span aria-hidden="true" className={checked ? "" : "invisible"}>
        ✓
      </span>
      {label}
    </label>
  );
}

/** Local-state ChipToggle (DeferredCheckbox philosophy) for claims. */
export function DeferredChipToggle({
  id,
  label,
  initialChecked,
  onValue,
}: {
  id: string;
  label: string;
  initialChecked: boolean;
  onValue: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <ChipToggle
      id={id}
      label={label}
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onValue(next);
      }}
    />
  );
}

export function CheckboxField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-line-strong bg-raised px-3 transition-colors duration-150 hover:border-primary">
      <input
        id={id}
        data-testid={id}
        type="checkbox"
        className="h-5 w-5 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-sm font-medium text-ink">{label}</span>
    </label>
  );
}
