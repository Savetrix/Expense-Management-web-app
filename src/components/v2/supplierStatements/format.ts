import { formatDetailAmount } from "@/lib/invoiceDetailTheme";

import type { CandidateBill, LineMatchResult, MatchField, StatementStatus, SupplierStatement } from "./types";

export const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";

/** Compact inline action used inside table rows (same chip as the Vendors list actions). */
export const ROW_ACTION_CLASS =
  "flex h-8 shrink-0 items-center gap-[var(--space-xs)] rounded-md bg-accent/10 px-[var(--space-sm)] text-caption font-bold text-accent disabled:cursor-not-allowed disabled:opacity-60";
export const ROW_ACTION_NEUTRAL_CLASS =
  "flex h-8 shrink-0 items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-bold text-content-primary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60";

/** "2026-09-03" → "Sep 3, 2026" (UTC so the day never shifts by timezone). */
export function formatDate(ymd: string): string {
  if (!ymd) return "—";
  const date = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function formatPeriod(start: string, end: string): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export const money = (amount: number, currency?: string) => formatDetailAmount(amount, currency);

export const STATUS_META: Record<StatementStatus, { label: string; variant: "success" | "warning" | "neutral" }> = {
  processing: { label: "Processing", variant: "neutral" },
  needs_matching: { label: "Needs matching", variant: "warning" },
  reconciled: { label: "Reconciled", variant: "success" },
};

export const RESULT_META: Record<LineMatchResult, { label: string; variant: "success" | "warning" | "error" | "neutral" }> = {
  matched: { label: "Matched", variant: "success" },
  partial: { label: "Partly matched", variant: "warning" },
  unmatched: { label: "Unmatched", variant: "error" },
  missing: { label: "Missing invoice", variant: "neutral" },
};

export const FIELD_NAMES: Record<MatchField, string> = {
  vendor: "Vendor",
  date: "Date",
  amount: "Amount",
  reference: "Reference",
};

export function billValueFor(bill: CandidateBill, field: MatchField): string {
  switch (field) {
    case "vendor":
      return bill.vendor;
    case "date":
      return formatDate(bill.date);
    case "amount":
      return money(bill.amount, bill.currency);
    case "reference":
      return bill.number;
  }
}

export function isResolved(result: LineMatchResult): boolean {
  return result === "matched" || result === "missing";
}

export function summarize(statement: SupplierStatement, bills: CandidateBill[]) {
  const counts = { matched: 0, partial: 0, unmatched: 0, missing: 0 };
  let billsTotal = 0;
  for (const line of statement.lines) {
    counts[line.result] += 1;
    if (line.result === "matched" && line.billId) {
      billsTotal += bills.find((b) => b.id === line.billId)?.amount ?? 0;
    }
  }
  const resolved = counts.matched + counts.missing;
  return {
    counts,
    billsTotal,
    difference: Math.round((statement.balance - billsTotal) * 100) / 100,
    resolved,
    total: statement.lines.length,
    allResolved: statement.lines.length > 0 && resolved === statement.lines.length,
  };
}
