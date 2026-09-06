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
      {action && <div className="flex shrink-0 items-center gap-[var(--space-sm)]">{action}</div>}
    </div>
  );
}
