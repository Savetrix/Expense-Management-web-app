"use client";

import { Eye, EyeOff } from "lucide-react";
import { InputHTMLAttributes, forwardRef, useState } from "react";

interface PasswordInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

// Password field with a show/hide toggle icon inside the input. `ui/Input`
// has no icon slot and is frozen for this workflow (see SearchInput), and
// this pattern was previously hand-duplicated per auth screen (LoginForm,
// RegisterForm, ResetPasswordContent) as a label-row text button instead of
// an inline icon — lives here so v2 auth screens can share one implementation.
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { label, error, className = "", id, name, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const inputId = id ?? name;

  return (
    <div className="flex flex-col gap-[var(--space-xs)]">
      {label && (
        <label htmlFor={inputId} className="text-body-sm font-semibold text-content-primary">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          name={name}
          type={visible ? "text" : "password"}
          className={`h-[50px] w-full rounded-md border bg-surface pl-[var(--space-md)] pr-11 text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 ${
            error ? "border-status-danger-border" : "border-border"
          } ${className}`}
          {...props}
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex items-center px-[var(--space-md)] text-accent hover:opacity-80"
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}
        </button>
      </div>
      {error && <p className="text-caption font-medium text-status-danger-text">{error}</p>}
    </div>
  );
});
