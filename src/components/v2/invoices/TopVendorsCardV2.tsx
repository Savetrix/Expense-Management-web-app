"use client";

import { useMemo } from "react";

import { computeTopVendors } from "@/lib/topVendors";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";
import { ProgressBar } from "@/components/v2/ui";

// Same computeTopVendors data source as the original TopVendorsCard — only
// the bar treatment changed (cycled palette instead of one flat accent) to
// match the reference design's multi-tone vendor bars.
const BAR_COLORS = ["bg-primary-500", "bg-primary-600", "bg-nav-active", "bg-primary-400", "bg-primary-700"];

export function TopVendorsCardV2({ invoices, className = "" }: { invoices: InvoiceRecord[]; className?: string }) {
  const { vendors, scopedToMonth } = useMemo(() => computeTopVendors(invoices), [invoices]);
  const max = vendors[0]?.total || 0;

  if (vendors.length === 0) return null;

  return (
    <div className={`rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm ${className}`}>
      <h4 className="text-body font-bold text-content-primary">
        {scopedToMonth ? "Top vendors this month" : "Top vendors"}
      </h4>
      <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-md)]">
        {vendors.map(({ vendor, total, currency }, i) => {
          const pct = max > 0 ? Math.max(Math.round((total / max) * 100), 8) : 8;
          const amount = `${currency} ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim();
          return (
            <div key={vendor}>
              <div className="flex items-center justify-between gap-[var(--space-sm)] text-body-sm">
                <span className="truncate text-content-primary">{vendor}</span>
                <span className="shrink-0 font-bold text-content-primary">{amount}</span>
              </div>
              <div className="mt-[var(--space-xs)]">
                <ProgressBar percent={pct} colorClassName={BAR_COLORS[i % BAR_COLORS.length]} label={`${vendor} ${amount}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
