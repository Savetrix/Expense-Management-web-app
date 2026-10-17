"use client";

import Link from "next/link";
import { CreditCard, Sparkles, Tag } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { SelectDropdown } from "@/components/v2/ui";
import { CodingReasoningModal } from "@/components/v2/invoiceInsights/CodingReasoningModal";
import { MARK_AS_OPTIONS, MarkAsModal, type MarkAsKind } from "@/components/v2/invoiceInsights/MarkAsModal";

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
}

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
}: InvoiceInsightsPanelProps) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [markAs, setMarkAs] = useState<MarkAsKind | null>(null);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="border-b border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
        <span className="text-caption font-bold uppercase tracking-wide text-content-secondary">AI Insights</span>
      </div>
      <div className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)]">
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
          />,
          document.body,
        )}
    </div>
  );
}
