// Content-shaped loading placeholder. Per DESIGN_ASSUMPTIONS.md D2.2
// research, this is the researched-preferred pattern over a spinner for
// list/dashboard content specifically (Stripe/Linear/Notion-style shimmer)
// since it previews the layout that's about to arrive rather than an
// abstract "something is happening" indicator.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-border/60 ${className}`} />;
}

// A list of skeleton "rows" shaped like this app's card-style list items
// (dashboard recent invoices, invoice list, pending queue, team members,
// vendor list) — one shared shape instead of a bespoke placeholder per page.
export function SkeletonListRows({ count = 3, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-[var(--space-sm)] ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
          <div className="flex items-center justify-between gap-[var(--space-sm)]">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="mt-[var(--space-sm)] h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
