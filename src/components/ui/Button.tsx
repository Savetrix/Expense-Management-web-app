"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

// Text colors are chosen for WCAG AA contrast (4.5:1) against each
// variant's background, verified by direct calculation — not just visual
// judgment. `accent` (bg-primary) is teal (#1FB6AA) in BOTH light and dark
// mode — white text fails AA against it, so `primary` uses a fixed dark
// foreground instead of a token that flips with the theme (text-text-primary
// itself flips to near-white in dark mode, which would recreate the same
// failure there). Same reasoning for `danger`: status-danger-text is a light
// salmon in dark mode, so the button uses a fixed strong red rather than
// that token as a fill. `secondary` uses trust-navy's LIGHT-mode value as a
// fixed color — trust-navy itself now flips to near-white in dark mode
// (correct for on-surface text, wrong for a solid button fill). See
// DESIGN_ASSUMPTIONS.md D2.3.
const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-accent-ink hover:opacity-90",
  secondary: "bg-[rgb(31,58,95)] text-white hover:opacity-90",
  outline: "bg-surface text-content-primary border border-border hover:bg-surface-alt",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

const spinnerToneClasses: Record<ButtonVariant, string> = {
  primary: "border-black/20 border-t-black/70",
  secondary: "border-white/40 border-t-white",
  outline: "border-content-primary/30 border-t-content-primary",
  danger: "border-white/40 border-t-white",
};

// sm is 44px tall (not the 36px it used to be) to meet the 44x44px minimum
// touch target size — see DESIGN_ASSUMPTIONS.md D2.3.
const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-11 px-[var(--space-sm)] text-body-sm",
  md: "h-[50px] px-[var(--space-md)] text-body",
  lg: "h-14 px-[var(--space-lg)] text-h3",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    disabled,
    className = "",
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className={`h-4 w-4 animate-spin rounded-full border-2 ${spinnerToneClasses[variant]}`}
        />
      )}
      {children}
    </button>
  );
});
