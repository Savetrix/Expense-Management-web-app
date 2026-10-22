"use client";

import Link from "next/link";
import { CalendarRange, CreditCard, Landmark, Sparkles, Tag } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { SelectDropdown } from "@/components/v2/ui";
import { CodingReasoningModal } from "@/components/v2/invoiceInsights/CodingReasoningModal";
import { MARK_AS_OPTIONS, MarkAsModal, type MarkAsKind } from "@/components/v2/invoiceInsights/MarkAsModal";
import { useInvoiceInsights } from "@/components/v2/invoiceInsights/useInvoiceInsights";
import { showToast } from "@/lib/dialogManager";
import { updateBankTransaction } from "@/store/bankFeeds/bankFeedsApi";
import { useAppDispatch } from "@/store/hooks";

// Compact "AI insights" card for the invoice detail side panel: the coding
// decision trail, a "Mark as" reclassification menu, and a shortcut to pay.
// Mounted once from InvoiceDetailContentV2; all state lives here.

interface InvoiceInsightsPanelProps {
  vendorName: string;
  glCode: string;
  publishedBy: string;
  isAutopilot: boolean;
  /** Posted (auto or manual) — only then is "Pay this bill" offered. */
  isPosted: boolean;
  totalAmount: number;
  totalAmountDisplay?: string;
  currency?: string;
  invoiceDate?: string;
  /** Backend invoice id, for the period and bank-match insights. */
  invoiceId?: string;
}

const monthYear = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
const dayMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const money = (n: number) => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ROW_BUTTON_CLASS =
  "flex w-full items-center gap-[var(--space-sm)] rounded-md border border-border bg-surface px-[var(--space-sm)] py-[var(--space-xs)] text-left text-caption font-semibold text-content-primary hover:bg-surface-alt";

export function InvoiceInsightsPanel({
  vendorName,
  glCode,
  publishedBy,
  isAutopilot,
  isPosted,
  totalAmount,
  totalAmountDisplay,
  currency,
  invoiceDate,
  invoiceId,
}: InvoiceInsightsPanelProps) {
  const dispatch = useAppDispatch();
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [markAs, setMarkAs] = useState<MarkAsKind | null>(null);
  const { data: insights, reload, setDismissed } = useInvoiceInsights(invoiceId);
  const period = insights?.period ?? null;
  const matched = insights?.bank?.matched[0];
  const candidate = insights?.bank?.candidates[0];

  const matchCandidate = async () => {
    if (!candidate || !invoiceId) return;
    const result = await dispatch(updateBankTransaction({ id: candidate.id, patch: { status: "matched", matchedInvoiceId: invoiceId }, version: candidate.version }));
    if (updateBankTransaction.fulfilled.match(result)) {
      showToast("Matched to the bank line.", "success");
      void reload();
    } else showToast(result.payload?.message ?? "Couldn't match.", "error");
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="border-b border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
        <span className="text-caption font-bold uppercase tracking-wide text-content-secondary">AI Insights</span>
      </div>
      <div className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)]">
        {insights?.prepayment && period && !insights.dismissed && (
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
              <button type="button" className="h-7 rounded-md bg-primary px-[var(--space-sm)] text-caption font-bold text-accent-ink hover:opacity-90" onClick={() => setMarkAs("prepayment")}>
                Set up prepayment
              </button>
              <button type="button" className="h-7 rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt" onClick={() => setDismissed(true)}>
                Not a prepayment
              </button>
            </div>
          </div>
        )}
        {insights?.prepayment && insights.dismissed && (
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

        <button type="button" onClick={() => setReasoningOpen(true)} className={ROW_BUTTON_CLASS}>
          <Sparkles size={14} strokeWidth={2.25} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">Why Scantrix coded it this way</span>
        </button>

        <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
          <SelectDropdown
            uiSize="sm"
            icon={<Tag size={13} strokeWidth={2.25} />}
            aria-label="Mark as"
            value=""
            onChange={(e) => {
              if (e.target.value) setMarkAs(e.target.value as MarkAsKind);
            }}
            className="min-w-0 flex-1"
          >
            <option value="">Mark as…</option>
            {MARK_AS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </SelectDropdown>

          {isPosted && (
            <Link
              href="/payments"
              className="inline-flex h-8 shrink-0 items-center gap-[var(--space-xs)] rounded-md bg-primary px-[var(--space-sm)] text-caption font-bold text-accent-ink hover:opacity-90"
            >
              <CreditCard size={13} strokeWidth={2.25} />
              Pay this bill
            </Link>
          )}
        </div>
      </div>

      {/* Portalled to <body>: the side panel is its own stacking context, so a
          modal rendered inline would sit under the page's sticky header. */}
      {reasoningOpen &&
        createPortal(
          <CodingReasoningModal
            open
            onClose={() => setReasoningOpen(false)}
            vendorName={vendorName}
            glCode={glCode}
            publishedBy={publishedBy}
            isAutopilot={isAutopilot}
            totalAmountDisplay={totalAmountDisplay}
            invoiceDate={invoiceDate}
          />,
          document.body,
        )}
      {markAs &&
        createPortal(
          <MarkAsModal
            key={markAs}
            open
            initialKind={markAs}
            onClose={() => setMarkAs(null)}
            totalAmount={totalAmount}
            currency={currency}
            initialPeriod={period}
          />,
          document.body,
        )}
    </div>
  );
}
