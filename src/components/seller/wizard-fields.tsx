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
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  placeholder: string;
  disabled?: boolean;
  items: { id: string; name: string; code?: string }[];
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
          <option key={item.id} value={item.code ?? item.id}>
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
  onValue: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <input
        id={id}
        data-testid={id}
        className={fieldClass}
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
