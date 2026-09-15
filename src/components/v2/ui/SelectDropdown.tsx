import { ReactNode, SelectHTMLAttributes, forwardRef } from "react";

interface SelectDropdownProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  /** "md" (default) matches Input's 50px form-field height; "sm" is the
   *  compact filter-pill size used by list toolbars (Invoices, GL Account).
   *  Named `uiSize` (not `size`) — native <select> already has a numeric
   *  `size` HTML attribute (visible option-row count), which this would
   *  otherwise collide with. */
  uiSize?: "md" | "sm";
  /** Leading icon for the compact filter-pill variant (e.g. ArrowUpDown for a
   *  sort control). Only meaningful for uiSize="sm" — full-height form
   *  fields use `label` instead. */
  icon?: ReactNode;
}

// Styled wrapper around the native <select>, matching Input's visual
// language so a form mixing text inputs and dropdowns reads as one system.
// The `error` prop drives GL Account's "required but empty" red state; the
// compact `uiSize="sm"` (+ optional `icon`) covers Invoices/GL Account's
// filter-toolbar pills (Status/Vendor/Currency/sort).
export const SelectDropdown = forwardRef<HTMLSelectElement, SelectDropdownProps>(function SelectDropdown(
  { label, error, uiSize = "md", icon, className = "", id, name, children, ...props },
  ref,
) {
  const selectId = id ?? name;

  if (uiSize === "sm") {
    return (
      <label
        className={`inline-flex h-8 shrink-0 items-center gap-[var(--space-xs)] rounded-md border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt ${
          error ? "border-status-danger-border" : "border-border"
        } ${className}`}
      >
        {icon && <span className="shrink-0 text-content-secondary">{icon}</span>}
        <select
          ref={ref}
          id={selectId}
          name={name}
          className="border-0 bg-transparent p-0 text-caption font-semibold text-content-primary focus:outline-none"
          {...props}
        >
          {children}
        </select>
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-xs)]">
      {label && (
        <label htmlFor={selectId} className="text-body-sm font-semibold text-content-primary">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        name={name}
        className={`h-[50px] rounded-md border bg-surface px-[var(--space-md)] text-body text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40 ${
          error ? "border-status-danger-border bg-status-danger-bg" : "border-border"
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-caption font-medium text-status-danger-text">{error}</p>}
    </div>
  );
});
