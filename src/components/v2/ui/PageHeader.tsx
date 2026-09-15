import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

// Title + subtitle + optional right-aligned action/search slot — the
// recurring page-header pattern across Integrations, GL Account, Team,
// Vendors, and Subscription in the Stitch export.
export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-[var(--space-md)]">
      <div>
        <h1 className="text-h1 font-bold text-content-primary">{title}</h1>
        {subtitle && <p className="mt-[var(--space-xs)] text-body-sm text-content-secondary">{subtitle}</p>}
      </div>
      {/* Below sm the action slot claims its own full-width row (the parent is
          flex-wrap) and wraps internally, so a toolbar with a search field +
          button can't push the header wider than a phone viewport. From sm up
          it behaves exactly as before: a shrink-0 block beside the title. */}
      {action && (
        <div className="flex w-full flex-wrap items-center gap-[var(--space-sm)] sm:w-auto sm:shrink-0">{action}</div>
      )}
    </div>
  );
}
