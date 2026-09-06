"use client";

import { useMemo } from "react";

import { computeOutcomeMix } from "@/lib/outcomeMix";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

const OUTCOME_MIX_WEEKS = 5;
// r chosen so the circle's circumference is exactly 100 (2πr ≈ 100) — lets
// stroke-dasharray/stroke-dashoffset values be plain percentages instead of
// arc-length math.
const RADIUS = 15.9155;
const STROKE_WIDTH = 4;

interface Segment {
  key: "auto" | "manual" | "failed";
  label: string;
  count: number;
  colorClass: string;
}

// Rebuilt as a donut + labeled counts instead of the previous per-week
// stacked-bar chart: with only 5 rolling 7-day buckets, real usage is
// usually bursty (most invoices land in one or two recent weeks, the rest
// empty), so a bar-per-week view mostly showed empty bars and made judging
// composition from segment widths guesswork. A donut answers the actual
// question ("how is auto-posting doing overall, right now") directly, with
// the exact count/percent written out rather than left to eyeball — see the
// Outcome Mix design review. Same computeOutcomeMix data source, now
// summed across the window instead of kept per-week.
export function OutcomeMixCardV2({ invoices }: { invoices: InvoiceRecord[] }) {
  const { buckets, totals, max } = useMemo(() => computeOutcomeMix(invoices, OUTCOME_MIX_WEEKS), [invoices]);

  if (totals.total === 0) return null;

  const segments: Segment[] = [
    { key: "auto", label: "Auto", count: totals.auto, colorClass: "text-accent" },
    { key: "manual", label: "Manual", count: totals.manual, colorClass: "text-status-warning-text" },
    { key: "failed", label: "Failed", count: totals.failed, colorClass: "text-status-danger-text" },
  ];

  const autoPct = Math.round((totals.auto / totals.total) * 100);

  let cumulativePct = 0;
  const arcs = segments
    .filter((segment) => segment.count > 0)
    .map((segment) => {
      const pct = (segment.count / totals.total) * 100;
      const arc = {
        ...segment,
        pct,
        dashArray: `${pct} ${100 - pct}`,
        dashOffset: -cumulativePct,
      };
      cumulativePct += pct;
      return arc;
    });

  return (
    <div className="rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
      <div className="flex items-center justify-between">
        <h4 className="text-body font-bold text-content-primary">Outcome mix</h4>
        <span className="text-caption text-content-secondary">Last {OUTCOME_MIX_WEEKS} weeks</span>
      </div>

      <div className="mt-[var(--space-md)] flex items-center gap-[var(--space-lg)]">
        <div className="relative h-20 w-20 shrink-0">
          <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
            <circle
              cx="18"
              cy="18"
              r={RADIUS}
              fill="none"
              className="stroke-border"
              strokeWidth={STROKE_WIDTH}
            />
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                cx="18"
                cy="18"
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE_WIDTH}
                strokeDasharray={arc.dashArray}
                strokeDashoffset={arc.dashOffset}
                strokeLinecap="round"
                pathLength={100}
                className={arc.colorClass}
                stroke="currentColor"
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-body font-bold text-content-primary">{autoPct}%</span>
            <span className="text-tiny text-content-secondary">Auto</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-xs)]">
          {segments.map((segment) => {
            const pct = Math.round((segment.count / totals.total) * 100);
            return (
              <div key={segment.key} className="flex items-center justify-between gap-[var(--space-sm)] text-caption">
                <span className="flex items-center gap-[var(--space-xs)] text-content-secondary">
                  <span className={`h-2 w-2 rounded-full ${segment.colorClass.replace("text-", "bg-")}`} />
                  {segment.label}
                </span>
                <span className="font-semibold text-content-primary">
                  {segment.count} <span className="text-content-secondary">({pct}%)</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Weekly breakdown — the donut/legend above answer "how's it going
          overall"; this answers "which week did that come from". Kept
          alongside rather than instead of the donut per user feedback. Bars
          can legitimately be near-empty for most weeks (a new/bursty
          account concentrates volume in 1-2 recent weeks) — that's real
          signal, not a rendering bug. */}
      <div className="mt-[var(--space-md)] border-t border-border pt-[var(--space-md)]">
        <p className="text-tiny font-bold uppercase tracking-wider text-content-muted">Weekly breakdown</p>
        <div className="mt-[var(--space-sm)] grid grid-cols-5 items-end gap-[var(--space-sm)]">
          {buckets.map((bucket, i) => {
            const autoHeight = (bucket.auto / max) * 100;
            const manualHeight = (bucket.manual / max) * 100;
            const failedHeight = (bucket.failed / max) * 100;
            return (
              <div key={i} className="flex flex-col items-center gap-[var(--space-xs)]">
                <span className="text-tiny font-semibold text-content-secondary">{bucket.total || ""}</span>
                <div
                  className="flex h-16 w-full flex-col-reverse overflow-hidden rounded-sm bg-page"
                  title={`Week ${i + 1}: ${bucket.total} invoice${bucket.total === 1 ? "" : "s"} (${bucket.auto} auto, ${bucket.manual} manual, ${bucket.failed} failed)`}
                >
                  <div className="w-full bg-accent" style={{ height: `${autoHeight}%` }} />
                  <div className="w-full bg-status-warning-text" style={{ height: `${manualHeight}%` }} />
                  <div className="w-full bg-status-danger-text" style={{ height: `${failedHeight}%` }} />
                </div>
                <span className="text-tiny font-semibold text-content-secondary">W{i + 1}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
