import { ReactNode } from "react";

import { Button } from "@/components/ui/Button";

// One shared empty-state shape (icon + title + description + optional
// action) instead of a different bespoke tree per page. Per
// DESIGN_ASSUMPTIONS.md D2.2 research: always show a helpful message (never
// blank space), and an action when there's a next step to offer.
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionVariant = "outline",
  tone = "neutral",
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** "primary" when the action is the page's one next step (e.g. connecting a company). */
  actionVariant?: "primary" | "outline";
  tone?: "neutral" | "primary";
}) {
  return (
    <div className="flex flex-col items-center px-[var(--space-lg)] py-[var(--space-xl)] text-center">
      <span
        className={`mb-[var(--space-md)] flex h-16 w-16 items-center justify-center rounded-full ${
          tone === "primary" ? "bg-primary/10 text-primary" : "bg-background-alt text-text-secondary"
        }`}
      >
        {icon}
      </span>
      <p className="text-h3 font-bold text-text-primary">{title}</p>
      {description && <p className="mt-[var(--space-xs)] max-w-sm text-body-sm text-text-secondary">{description}</p>}
      {actionLabel && onAction && (
        <Button variant={actionVariant} size="sm" onClick={onAction} className="mt-[var(--space-lg)]">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
