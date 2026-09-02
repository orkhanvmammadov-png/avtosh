import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/**
 * Approved form-control recipe (components.md): h40 (44–48 touch),
 * radius 6, raised bg, border-strong border; hover #8A8F98; focus
 * green border + soft ring; disabled sunken. Visual layer only —
 * components with load-bearing field logic keep their own markup and
 * consume `controlClasses`.
 */

export function controlClasses(extra = ""): string {
  return `block w-full min-h-10 rounded-control border border-line-strong bg-raised px-3 text-sm text-ink placeholder:text-muted transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none focus:shadow-[0_0_0_2px_rgba(20,122,78,0.25)] disabled:bg-sunken disabled:text-muted disabled:hover:border-line-strong max-md:min-h-12 ${extra}`;
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
  return <textarea className={controlClasses(`min-h-24 py-2 leading-relaxed ${className}`)} {...props} />;
}

export function Checkbox({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 shrink-0 rounded accent-[var(--color-primary)] ${className}`}
      {...props}
    />
  );
}
