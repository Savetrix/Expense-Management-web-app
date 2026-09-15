import { InputHTMLAttributes, forwardRef } from "react";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

// Theme-aware text field for v2 screens. `ui/Input` hardcodes bg-white /
// text-trust-navy, which stays legible in light mode but not dark mode
// (frozen for this workflow — see PasswordInput/SearchInput) — this mirrors
// PasswordInput's token classes instead so labels, borders, and typed text
// all repaint correctly under the dark theme.
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, error, className = "", id, name, ...props },
  ref,
) {
  const inputId = id ?? name;
  return (
    <div className="flex flex-col gap-[var(--space-xs)]">
      {label && (
        <label htmlFor={inputId} className="text-body-sm font-semibold text-content-primary">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        name={name}
        className={`h-[50px] rounded-md border bg-surface px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 ${
          error ? "border-status-danger-border" : "border-border"
        } ${className}`}
        {...props}
      />
      {error && <p className="text-caption font-medium text-status-danger-text">{error}</p>}
    </div>
  );
});
