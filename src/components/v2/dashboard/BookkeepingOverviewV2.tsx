"use client";

import Link from "next/link";
import {
  Archive,
  ArrowRight,
  Banknote,
  Bot,
  CalendarCheck,
  Car,
  FileSearch,
  History,
  Inbox,
  Repeat,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { ProgressBar } from "@/components/v2/ui";

// Dashboard summary for the bookkeeping features. Only numbers the app really
// has are shown (invoice counts). Anything that needs the backend is a link
// into its page, not an invented figure.

interface BookkeepingOverviewProps {
  processedCount: number;
  autoPostedCount: number;
  pendingCount: number;
  failedCount: number;
}

const SHORTCUTS: { href: string; label: string; description: string; icon: LucideIcon }[] = [
  { href: "/autopilot", label: "Autopilot", description: "Documents published without review, and why the rest wait.", icon: Bot },
  { href: "/archive", label: "Archive & Duplicates", description: "Duplicates and non-financial documents, kept out of your books.", icon: Archive },
  { href: "/supplier-statements", label: "Supplier Statements", description: "Match vendor statements against your bills.", icon: FileSearch },
  { href: "/expense-claims", label: "Expense Claims", description: "Receipts and mileage grouped into claims.", icon: Car },
  { href: "/bank-transactions", label: "Bank Transactions", description: "Connect a bank with Plaid or import a file, then match to bills.", icon: Banknote },
  { href: "/payments", label: "Payments", description: "Pay bills in batches, with approvals.", icon: Wallet },
  { href: "/month-end", label: "Month-End Adjustments", description: "Prepayments, deferred income, assets and accruals.", icon: Repeat },
  { href: "/close", label: "Working Papers", description: "Reconcile and lock the period.", icon: CalendarCheck },
  { href: "/requests", label: "Paperwork Requests", description: "Chase missing documents by email.", icon: Inbox },
  { href: "/audit-trail", label: "Audit Trail", description: "Who changed what, and when.", icon: History },
];

export function BookkeepingOverviewV2({ processedCount, autoPostedCount, pendingCount, failedCount }: BookkeepingOverviewProps) {
  const autopostPercent = processedCount > 0 ? Math.round((autoPostedCount / processedCount) * 100) : 0;
  const attention = pendingCount + failedCount;

  return (
    <section className="flex min-w-0 flex-col gap-[var(--space-md)] sm:col-span-2 lg:col-span-6" aria-label="Bookkeeping overview">
      <div className="grid grid-cols-1 gap-[var(--space-md)] md:grid-cols-2">
        <Link
          href="/autopilot"
          className="rounded-lg border border-border p-[var(--space-lg)] shadow-sm transition-colors hover:bg-surface-alt"
        >
          <div className="flex items-center justify-between gap-[var(--space-sm)]">
            <div className="flex items-center gap-[var(--space-sm)]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-bg text-accent-text-on-bg">
                <Bot size={18} strokeWidth={2} />
              </span>
              <div>
                <h4 className="text-body font-bold text-content-primary">Autopilot</h4>
                <p className="text-caption text-content-secondary">Invoices posted without manual review</p>
              </div>
            </div>
            <span className="text-h3 font-bold text-content-primary">{processedCount > 0 ? `${autopostPercent}%` : "—"}</span>
          </div>
          <div className="mt-[var(--space-md)]">
            <ProgressBar percent={autopostPercent} />
          </div>
          <p className="mt-[var(--space-sm)] text-caption text-content-secondary">
            {autoPostedCount} of {processedCount} invoice{processedCount === 1 ? "" : "s"} auto-posted
          </p>
        </Link>

        <div className="rounded-lg border border-border p-[var(--space-lg)] shadow-sm">
          <div className="flex items-center justify-between gap-[var(--space-sm)]">
            <div>
              <h4 className="text-body font-bold text-content-primary">Needs your attention</h4>
              <p className="text-caption text-content-secondary">
                {attention === 0 ? "Nothing is waiting on you." : "Items that are waiting on a person."}
              </p>
            </div>
            <span className="text-h3 font-bold text-content-primary">{attention}</span>
          </div>
          <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-xs)]">
            <AttentionRow href="/invoices?type=pending" label="Invoices to review" count={pendingCount} />
            <AttentionRow href="/invoices?type=failed" label="Failed invoices" count={failedCount} />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border p-[var(--space-lg)] shadow-sm">
        <h4 className="text-body font-bold text-content-primary">Bookkeeping</h4>
        <p className="text-caption text-content-secondary">Everything after capture, in one place.</p>
        <div className="mt-[var(--space-md)] grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2 lg:grid-cols-3">
          {SHORTCUTS.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-start gap-[var(--space-sm)] rounded-md border border-border bg-surface p-[var(--space-sm)] transition-colors hover:bg-surface-alt"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-content-secondary">
                <Icon size={16} strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-bold text-content-primary">{label}</span>
                <span className="block text-caption text-content-secondary">{description}</span>
              </span>
              <ArrowRight size={14} strokeWidth={2} className="mt-1 shrink-0 text-content-muted group-hover:text-content-primary" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function AttentionRow({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm font-semibold text-content-primary hover:bg-surface-alt"
    >
      <span>{label}</span>
      <span className="flex items-center gap-[var(--space-xs)]">
        <span className={count > 0 ? "text-status-warning-text" : "text-content-muted"}>{count}</span>
        <ArrowRight size={14} strokeWidth={2} className="text-content-muted" />
      </span>
    </Link>
  );
}
