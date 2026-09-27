"use client";

import { useMemo } from "react";

import { computeOutcomeMix } from "@/lib/outcomeMix";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

const OUTCOME_MIX_WEEKS = 5;

// Default state for the Invoices page's right-hand panel — shown whenever no
// row is selected. Auto/manual/failed colors match the badges used
// everywhere else on this page (bg-primary-500/bg-warning/bg-error), so this
// reads as the same three states rather than a new color language.
export function OutcomeMixCard({ invoices }: { invoices: InvoiceRecord[] }) {
  const { buckets, totals, max } = useMemo(() => computeOutcomeMix(invoices, OUTCOME_MIX_WEEKS), [invoices]);

  if (totals.total === 0) return null;

  const autoPct = Math.round((totals.auto / totals.total) * 100);
  const manualPct = Math.round((totals.manual / totals.total) * 100);
  const failedPct = Math.max(100 - autoPct - manualPct, 0);

  return (
    <div className="rounded-lg border border-border bg-white p-[var(--space-lg)]">
      <h4 className="text-body font-bold text-text-primary">Outcome mix</h4>
      <p className="text-caption text-text-secondary">Last {OUTCOME_MIX_WEEKS} weeks</p>

      <div className="mt-[var(--space-md)] flex h-3 overflow-hidden rounded-pill bg-background-alt">
        {autoPct > 0 && <div className="h-full bg-primary-500" style={{ width: `${autoPct}%` }} />}
        {manualPct > 0 && <div className="h-full bg-warning" style={{ width: `${manualPct}%` }} />}
        {failedPct > 0 && <div className="h-full bg-error" style={{ width: `${failedPct}%` }} />}
      </div>

      <div className="mt-[var(--space-md)] flex items-end gap-[6px]">
        {buckets.map((bucket, i) => {
          const autoHeight = (bucket.auto / max) * 100;
          const manualHeight = (bucket.manual / max) * 100;
          const failedHeight = (bucket.failed / max) * 100;
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-[var(--space-xs)]">
              <div
                className="flex h-20 w-full flex-col-reverse overflow-hidden rounded-sm bg-background-alt"
                title={`${bucket.total} invoice${bucket.total === 1 ? "" : "s"}`}
              >
                <div className="w-full bg-primary-500" style={{ height: `${autoHeight}%` }} />
                <div className="w-full bg-warning" style={{ height: `${manualHeight}%` }} />
                <div className="w-full bg-error" style={{ height: `${failedHeight}%` }} />
              </div>
              <span className="text-[10px] font-semibold text-text-secondary">W{i + 1}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-[var(--space-md)] flex flex-wrap items-center gap-[var(--space-md)] text-caption text-text-secondary">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-primary-500" />
          Auto
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-warning" />
          Manual
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-error" />
          Failed
        </span>
      </div>
    </div>
  );
}
