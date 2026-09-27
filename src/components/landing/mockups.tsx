"use client";

import { Check, Clock, FileText, Upload } from "lucide-react";

import { BrandIcon } from "@/components/icons/BrandIcon";

// ---------------------------------------------------------------------------
// Authentic recreations of real Scantrix screens, rebuilt as lightweight
// in-browser mockups for the landing page. Layout, status colors, and copy
// mirror the actual app (DashboardContent + lib/invoiceDisplay.ts) so the
// marketing surface and the product read as one product.
// ---------------------------------------------------------------------------

// Real invoice-status tints — mirrors the same status→token mapping
// lib/invoiceDisplay.ts uses (bg-status-success-bg/text-status-success-text
// etc.), rather than the literal hex that table has since migrated away
// from, so these mockups stay dark-mode-correct alongside the real app.
const TINT = {
  auto: { bgClass: "bg-status-success-bg", inkClass: "text-status-success-text", label: "Auto-Posted" },
  manual: { bgClass: "bg-status-warning-bg", inkClass: "text-status-warning-text", label: "Manually Posted" },
  failed: { bgClass: "bg-status-danger-bg", inkClass: "text-status-danger-text", label: "Failed" },
  pending: { bgClass: "bg-status-info-bg", inkClass: "text-status-info-text", label: "Pending" },
} as const;

export function BrowserFrame({
  children,
  label = "app.scantrix.ai/dashboard",
  className = "",
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-border bg-surface shadow-xl ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-border bg-[color:var(--lp-alt)] px-4 py-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#ef6a5f]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#f5bd4f]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#61c454]" />
        </span>
        <span className="mx-auto flex items-center gap-1.5 rounded-md bg-surface px-3 py-1 text-[11px] font-medium text-text-secondary">
          <span className="h-2 w-2 rounded-full bg-[color:var(--lp-teal)]" aria-hidden />
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

// A single extracted field row (Vendor, Invoice #, …) with a confirming check.
function FieldRow({
  field,
  value,
  delay,
}: {
  field: string;
  value: string;
  delay: number;
}) {
  return (
    <div
      className="lp-field flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="text-[12px] font-medium text-text-secondary">{field}</span>
      <span className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-text-primary">{value}</span>
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--lp-auto)]">
          <Check size={11} strokeWidth={3} className="text-white" />
        </span>
      </span>
    </div>
  );
}

// Hero signature: an invoice being read — scan sweep, fields populate, status
// flips from Processing to Auto-posted to QuickBooks. The one motion moment.
export function ExtractionDemo() {
  return (
    <BrowserFrame label="app.scantrix.ai/invoices/review">
      <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[0.92fr_1.08fr]">
        {/* Invoice document with the scan sweep */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-[color:var(--lp-soft)] p-4">
          <div
            className="lp-scanline pointer-events-none absolute inset-x-3 top-3 h-10 rounded-full"
            style={{
              background:
                "linear-gradient(to bottom, rgba(31,182,170,0) 0%, rgba(31,182,170,0.22) 55%, rgba(31,182,170,0) 100%)",
              boxShadow: "0 0 0 1px rgba(31,182,170,0.35)",
            }}
            aria-hidden
          />
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-bold text-text-primary">INVOICE</span>
            <FileText size={16} className="text-text-secondary" />
          </div>
          <div className="space-y-1">
            <div className="text-[12px] font-semibold text-text-primary">Northwind Supplies Co.</div>
            <div className="text-[10px] text-text-secondary">Invoice #INV-20418 · Jul 22, 2026</div>
          </div>
          <div className="my-3 h-px bg-border" />
          <div className="space-y-2">
            {[
              ["Paper stock, A4", "$420.00"],
              ["Toner cartridges", "$318.50"],
              ["Delivery", "$45.00"],
            ].map(([item, amt]) => (
              <div key={item} className="flex items-center justify-between text-[11px]">
                <span className="text-text-secondary">{item}</span>
                <span className="font-medium text-text-primary">{amt}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
            <span className="text-[11px] font-semibold text-text-secondary">Total</span>
            <span className="text-[15px] font-bold text-text-primary">$783.50</span>
          </div>
        </div>

        {/* Extracted fields + status flip */}
        <div className="flex flex-col">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--lp-teal-050)]">
              <span className="h-2 w-2 rounded-full bg-[color:var(--lp-teal)] lp-pulse" aria-hidden />
            </span>
            <span className="text-[12px] font-semibold text-trust-navy">Extracted by Scantrix</span>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <FieldRow field="Vendor" value="Northwind Supplies" delay={200} />
            <FieldRow field="Invoice #" value="INV-20418" delay={520} />
            <FieldRow field="Date" value="Jul 22, 2026" delay={840} />
            <FieldRow field="Total" value="$783.50" delay={1160} />
            <FieldRow field="Currency" value="USD" delay={1480} />
          </div>

          {/* Status bar — processing → posted, cross-fading in place */}
          <div className="relative mt-3 h-[46px]">
            <div className="lp-status-processing absolute inset-0 flex items-center gap-2.5 rounded-lg bg-status-warning-bg px-3.5">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-status-warning-text/30 border-t-status-warning-text" aria-hidden />
              <span className="text-[13px] font-semibold text-status-warning-text">Processing invoice…</span>
            </div>
            <div className="lp-status-posted absolute inset-0 flex items-center justify-between rounded-lg bg-status-success-bg px-3.5">
              <span className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--lp-auto)]">
                  <Check size={12} strokeWidth={3} className="text-white" />
                </span>
                <span className="text-[13px] font-semibold text-status-success-text">Auto-posted to QuickBooks</span>
              </span>
              <BrandIcon name="quickbooks" size={18} />
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

function SummaryCard({ tint, count, label }: { tint: keyof typeof TINT; count: number; label: string }) {
  const t = TINT[tint];
  return (
    <div className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-lg py-3 ${t.bgClass}`}>
      <span className={`text-[22px] font-bold leading-none ${t.inkClass}`}>{count}</span>
      <span className={`text-[10px] font-semibold ${t.inkClass}`}>{label}</span>
    </div>
  );
}

function InvoiceRow({ tint, title, amount }: { tint: keyof typeof TINT; title: string; amount: string }) {
  const t = TINT[tint];
  return (
    <div className={`flex items-center justify-between rounded-lg px-3.5 py-2.5 ${t.bgClass}`}>
      <div className="min-w-0">
        <div className="truncate text-[12px] font-bold text-text-primary">{title}</div>
        <div className="mt-0.5 text-[11px] text-text-secondary">{amount}</div>
      </div>
      <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide ${t.inkClass}`}>{t.label}</span>
    </div>
  );
}

// Real dashboard: greeting, upload, pending-review, summary cards, recent list.
export function DashboardPreview() {
  return (
    <BrowserFrame label="app.scantrix.ai/dashboard">
      <div className="space-y-3.5 p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold text-trust-navy">Good morning, Sahaj</span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-white">
            <Upload size={13} strokeWidth={2.25} /> Upload invoice
          </span>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-accent/20 bg-[color:var(--lp-soft)] px-3.5 py-3">
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-white">
              <Clock size={17} strokeWidth={2} />
            </span>
            <span>
              <span className="block text-[12px] font-bold text-trust-navy">Pending Review</span>
              <span className="block text-[11px] text-text-secondary">3 invoices need your review</span>
            </span>
          </span>
          <span className="flex h-6 min-w-6 items-center justify-center rounded-pill bg-primary px-1.5 text-[11px] font-bold text-white">3</span>
        </div>

        <div className="flex gap-2.5">
          <SummaryCard tint="auto" count={128} label="Auto-posted" />
          <SummaryCard tint="manual" count={14} label="Manual" />
          <SummaryCard tint="failed" count={2} label="Failed" />
        </div>

        <div className="pt-0.5 text-[12px] font-bold text-text-primary">Recent</div>
        <div className="space-y-2">
          <InvoiceRow tint="auto" title="Northwind Supplies #INV-20418" amount="USD 783.50" />
          <InvoiceRow tint="pending" title="Contoso Ltd #4471" amount="USD 1,240.00" />
          <InvoiceRow tint="manual" title="Fabrikam Inc #8820" amount="USD 96.00" />
        </div>
      </div>
    </BrowserFrame>
  );
}

// --- How-it-works step visuals -------------------------------------------

export function ScanVisual() {
  return (
    <div className="rounded-xl border border-dashed border-[color:var(--lp-teal)]/50 bg-[color:var(--lp-teal-050)] p-4">
      <div className="flex flex-col items-center justify-center gap-2 py-3 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface shadow-sm">
          <Upload size={19} className="text-[color:var(--lp-teal-600)]" strokeWidth={2} />
        </span>
        <span className="text-[12px] font-semibold text-trust-navy">Drop a PDF or photo</span>
        <span className="text-[11px] text-text-secondary">Northwind-INV-20418.pdf</span>
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 shadow-sm">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden />
        <span className="text-[11px] font-medium text-text-secondary">Processing invoice…</span>
      </div>
    </div>
  );
}

export function MatchVisual() {
  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between rounded-lg bg-[color:var(--lp-soft)] px-3 py-2.5">
        <span className="text-[11px] text-text-secondary">Read vendor</span>
        <span className="text-[12px] font-semibold text-text-primary">Northwind Supplies</span>
      </div>
      <div className="flex justify-center">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--lp-teal-050)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 4v16M12 20l5-5M12 20l-5-5" stroke="var(--lp-teal-600)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-status-success-border bg-status-success-bg px-3 py-2.5">
        <span className="flex items-center gap-2">
          <BrandIcon name="quickbooks" size={15} />
          <span className="text-[12px] font-semibold text-text-primary">Northwind Supplies Co.</span>
        </span>
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lp-auto)]">
          <Check size={12} strokeWidth={3} /> Matched
        </span>
      </div>
    </div>
  );
}

export function PostVisual() {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <span className="flex items-center gap-2">
          <BrandIcon name="quickbooks" size={18} />
          <span className="text-[12px] font-bold text-text-primary">Bill created</span>
        </span>
        <span className="rounded-pill bg-status-success-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-status-success-text">Auto-posted</span>
      </div>
      <div className="space-y-2 pt-3 text-[11px]">
        <div className="flex justify-between"><span className="text-text-secondary">Vendor</span><span className="font-semibold text-text-primary">Northwind Supplies Co.</span></div>
        <div className="flex justify-between"><span className="text-text-secondary">Bill no.</span><span className="font-semibold text-text-primary">INV-20418</span></div>
        <div className="flex justify-between"><span className="text-text-secondary">Amount</span><span className="font-bold text-text-primary">$783.50</span></div>
      </div>
    </div>
  );
}
