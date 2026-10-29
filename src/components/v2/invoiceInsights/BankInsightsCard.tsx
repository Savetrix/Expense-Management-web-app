"use client";

import Link from "next/link";
import { CalendarRange, Landmark } from "lucide-react";

import { useInvoiceInsights } from "@/components/v2/invoiceInsights/useInvoiceInsights";
import { showToast } from "@/lib/dialogManager";
import { updateBankTransaction } from "@/store/bankFeeds/bankFeedsApi";
import { useAppDispatch } from "@/store/hooks";

// What the bank feature noticed on one invoice: the period it covers (a bill
// longer than a month is a prepayment) and the bank line that paid it, or one
// that looks like it. Renders nothing when there is nothing to say, or when bank
// feeds aren't set up on this server.

const monthYear = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
const dayMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const money = (n: number) => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ROW_BUTTON_CLASS =
  "flex w-full items-center gap-[var(--space-sm)] rounded-md border border-border bg-surface px-[var(--space-sm)] py-[var(--space-xs)] text-left text-caption font-semibold text-content-primary hover:bg-surface-alt";

export function BankInsightsCard({ invoiceId }: { invoiceId: string }) {
  const dispatch = useAppDispatch();
  const { data: insights, reload, setDismissed } = useInvoiceInsights(invoiceId);
  const period = insights?.period ?? null;
  const matched = insights?.bank?.matched[0];
  const candidate = insights?.bank?.candidates[0];
  const showPrepayment = Boolean(insights?.prepayment && period);
  if (!insights || (!showPrepayment && !matched && !candidate)) return null;

  const matchCandidate = async () => {
    if (!candidate) return;
    const result = await dispatch(updateBankTransaction({ id: candidate.id, patch: { status: "matched", matchedInvoiceId: invoiceId }, version: candidate.version }));
    if (updateBankTransaction.fulfilled.match(result)) {
      showToast("Matched to the bank line.", "success");
      reload();
    } else showToast(result.payload?.message ?? "Couldn't match.", "error");
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="border-b border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
        <span className="text-caption font-bold uppercase tracking-wide text-content-secondary">Bank &amp; period</span>
      </div>
      <div className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)]">
        {showPrepayment && period && !insights.dismissed && (
          <div className="rounded-md border border-border bg-surface-alt p-[var(--space-sm)]">
            <p className="flex items-start gap-[var(--space-xs)] text-caption text-content-primary">
              <CalendarRange size={14} strokeWidth={2.25} className="mt-0.5 shrink-0 text-accent" />
              <span>
                <span className="font-bold">Prepayment detected</span>
                <span className="block text-content-secondary">
                  Covers {monthYear(period.start)} – {monthYear(period.end)} ({period.months} months), so it is spread over that time rather than expensed now.
                </span>
              </span>
            </p>
            <div className="mt-[var(--space-xs)] flex flex-wrap gap-[var(--space-xs)]">
              <button type="button" className="h-7 rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt" onClick={() => setDismissed(true)}>
                Not a prepayment
              </button>
            </div>
          </div>
        )}
        {showPrepayment && insights.dismissed && (
          <p className="text-caption text-content-secondary">
            Marked as not a prepayment.{" "}
            <button type="button" className="font-semibold underline" onClick={() => setDismissed(false)}>
              Undo
            </button>
          </p>
        )}

        {matched && (
          <Link href={`/bank-transactions?open=${matched.id}`} className={ROW_BUTTON_CLASS}>
            <Landmark size={14} strokeWidth={2.25} className="shrink-0 text-status-success-text" />
            <span className="min-w-0 flex-1 truncate">
              Paid from {matched.accountName} on {dayMonth(matched.date)}
            </span>
          </Link>
        )}
        {!matched && candidate && (
          <div className="rounded-md border border-border bg-surface-alt p-[var(--space-sm)]">
            <p className="flex items-start gap-[var(--space-xs)] text-caption text-content-primary">
              <Landmark size={14} strokeWidth={2.25} className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="font-bold">Matching bank transaction found</span>
                <span className="block truncate text-content-secondary">
                  {candidate.description || candidate.accountName} · {dayMonth(candidate.date)} · {money(candidate.amount)}
                </span>
              </span>
            </p>
            <div className="mt-[var(--space-xs)] flex flex-wrap gap-[var(--space-xs)]">
              <button type="button" className="h-7 rounded-md bg-primary px-[var(--space-sm)] text-caption font-bold text-accent-ink hover:opacity-90" onClick={matchCandidate}>
                Match
              </button>
              <Link href={`/bank-transactions?open=${candidate.id}`} className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt">
                View
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
