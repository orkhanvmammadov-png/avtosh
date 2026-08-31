import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/**
 * Form-control primitives — visual layer only. Components with
 * load-bearing field logic (wizard fields, filters, editors) keep
 * their own markup and consume `controlClasses` so every surface
 * shares one control recipe.
 */

export function controlClasses(extra = ""): string {
  return `block w-full min-h-12 rounded-control border border-line bg-raised px-3 text-sm text-navy placeholder:text-faint transition-colors hover:border-line-strong disabled:bg-sunken disabled:text-muted disabled:hover:border-line ${extra}`;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={controlClasses(className)} {...props} />;
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={controlClasses(className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={controlClasses(`min-h-24 py-2 ${className}`)} {...props} />;
}

export function Checkbox({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={`h-5 w-5 shrink-0 rounded border-line accent-[var(--color-primary)] ${className}`}
      {...props}
    />
  );
}
