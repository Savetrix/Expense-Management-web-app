"use client";

import { useMemo } from "react";

import { computeTopVendors } from "@/lib/topVendors";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

export function TopVendorsCard({ invoices, className = "" }: { invoices: InvoiceRecord[]; className?: string }) {
  const { vendors, scopedToMonth } = useMemo(() => computeTopVendors(invoices), [invoices]);
  const max = vendors[0]?.total || 0;

  if (vendors.length === 0) return null;

  return (
    <div className={`rounded-lg bg-background-soft p-[var(--space-lg)] ${className}`}>
      <h4 className="text-body font-bold text-text-primary">
        {scopedToMonth ? "Top vendors this month" : "Top vendors"}
      </h4>
      <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-sm)]">
        {vendors.map(({ vendor, total, currency }) => {
          const pct = max > 0 ? Math.max(Math.round((total / max) * 100), 6) : 6;
          return (
            <div key={vendor}>
              <div className="flex items-center justify-between gap-[var(--space-sm)] text-body-sm">
                <span className="truncate text-text-primary">{vendor}</span>
                <span className="shrink-0 font-bold text-text-primary">
                  {`${currency} ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim()}
                </span>
              </div>
              <div className="mt-[var(--space-xs)] h-2 rounded-pill bg-surface-alt">
                <div className="h-2 rounded-pill bg-accent" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
