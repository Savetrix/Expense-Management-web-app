import { InputHTMLAttributes, forwardRef } from "react";
import { Search } from "lucide-react";

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Constrains width on larger viewports (e.g. "lg:w-72"); full-width below that. */
  widthClassName?: string;
}

// Icon-prefixed compact search field — the pattern repeated across nearly
// every Stitch list/table toolbar (Invoices, GL Account, Vendors, the
// Integrations connector filter). `ui/Input` doesn't support a leading icon
// and is frozen for this workflow, so this lives here instead of forking
// Input inline per screen.
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { widthClassName = "lg:w-72", className = "", ...props },
  ref,
) {
  return (
    <label
      className={`flex min-w-0 flex-1 items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] py-[var(--space-xs)] focus-within:ring-2 focus-within:ring-accent/40 lg:flex-none ${widthClassName}`}
    >
      <Search size={14} strokeWidth={2.25} className="shrink-0 text-content-secondary" />
      <input
        ref={ref}
        type="text"
        className={`w-full min-w-0 bg-transparent text-body-sm text-content-primary outline-none placeholder:text-content-secondary ${className}`}
        {...props}
      />
    </label>
  );
});
