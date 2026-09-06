import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface CompactListRowProps {
  /** Monospace code chip, e.g. a GL account code. Omit for rows without one (Vendors). */
  code?: string;
  title: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
}

// Flatter list-as-card row used by GL Account & Tax Code and Vendors in the
// Stitch export, as an alternative to the full DataTable for screens whose
// rows are single-field-forward rather than tabular.
export function CompactListRow({ code, title, meta, onClick, trailing }: CompactListRowProps) {
  const interactive = Boolean(onClick);
  return (
    <article
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") onClick?.();
            }
          : undefined
      }
      className={`flex items-center justify-between gap-[var(--space-md)] rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)] ${
        interactive ? "cursor-pointer hover:shadow-sm" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-[var(--space-md)]">
        {code && (
          <span className="shrink-0 rounded-sm bg-accent-bg px-[var(--space-sm)] py-[var(--space-xs)] font-mono text-caption font-bold text-accent-text-on-bg">
            {code}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-body-sm font-semibold text-content-primary">{title}</p>
          {meta && <p className="truncate text-caption text-content-secondary">{meta}</p>}
        </div>
      </div>
      {trailing ?? (interactive && <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-content-muted" />)}
    </article>
  );
}
