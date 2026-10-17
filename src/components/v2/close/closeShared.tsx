"use client";

import { Badge } from "@/components/ui/Badge";
import { formatDetailAmount, formatDetailDate, formatDetailDateTime } from "@/lib/invoiceDetailTheme";
import { formatPlainDate } from "@/lib/plainDate";
import { useAppSelector } from "@/store/hooks";

import type { BalanceSheetAccount, SectionKey, SectionStatus, SignOff, WorkingPaper } from "./mockData";

export const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
export const FIELD_INPUT_CLASS =
  "mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";
export const FIELD_TEXTAREA_CLASS =
  "mt-[var(--space-xs)] min-h-[96px] w-full rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40";
export const FILE_INPUT_CLASS =
  "mt-[var(--space-xs)] block w-full text-body-sm text-content-secondary file:mr-[var(--space-sm)] file:rounded-md file:border file:border-border file:bg-surface file:px-[var(--space-sm)] file:py-[var(--space-xs)] file:text-body-sm file:font-semibold file:text-content-primary";
export const TABLE_HEADER_CLASS = "px-[var(--space-sm)] py-[var(--space-sm)] text-tiny font-bold uppercase tracking-wider text-content-muted";
export const CARD_CLASS = "overflow-hidden rounded-lg border border-border bg-surface shadow-sm";

export const money = (amount: number) => formatDetailAmount(amount);
export const date = (iso?: string) => formatPlainDate(iso, { month: "long", day: "numeric", year: "numeric" });
export const dateTime = (iso?: string) => formatDetailDateTime(iso);
export const signOffText = (prefix: string, s: SignOff) => `${prefix} by ${s.by}, ${formatDetailDate(s.at)}`;

export const SECTION_ORDER: SectionKey[] = ["invoices", "adjustments", "payablesReceivables", "fixedAssets", "balanceSheet"];

export const SECTION_TITLES: Record<SectionKey, string> = {
  invoices: "Post pending invoices",
  adjustments: "Post pending adjustments",
  payablesReceivables: "Payables & receivables review",
  fixedAssets: "Fixed assets review",
  balanceSheet: "Balance sheet reconciliation",
};

/** Sum of carried-forward line items plus added support for an account. */
export const supportTotal = (a: BalanceSheetAccount) =>
  a.lineItems.reduce((sum, li) => sum + li.amount, 0) + a.supports.reduce((sum, s) => sum + s.amount, 0);

/** Rounded to cents so float noise never shows as a difference. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Managed and dormant accounts reconcile themselves; others need a sign-off. */
export const accountIsReconciled = (a: BalanceSheetAccount) => Boolean(a.managedBy || a.dormant || a.reconciled);

export const fixedAssetsMatched = (wp: WorkingPaper) =>
  round2(wp.fixedAssets.registerCost - wp.fixedAssets.ledgerCost) === 0 &&
  round2(wp.fixedAssets.registerDepreciation - wp.fixedAssets.ledgerDepreciation) === 0;

function sectionDone(wp: WorkingPaper, key: SectionKey): boolean {
  switch (key) {
    case "invoices":
      return wp.documents.length === 0;
    case "adjustments":
      return wp.adjustments.length === 0;
    case "payablesReceivables":
      return Boolean(wp.payablesReconciled && wp.receivablesReconciled);
    case "fixedAssets":
      return fixedAssetsMatched(wp) || Boolean(wp.fixedAssets.reconciled);
    case "balanceSheet":
      return wp.accounts.every(accountIsReconciled);
  }
}

export function sectionStatus(wp: WorkingPaper, key: SectionKey): SectionStatus {
  if (sectionDone(wp, key)) return "done";
  return wp.touched[key] ? "in_progress" : "todo";
}

const STATUS_BADGE: Record<SectionStatus, { label: string; variant: "success" | "warning" | "neutral" }> = {
  todo: { label: "To do", variant: "neutral" },
  in_progress: { label: "In progress", variant: "warning" },
  done: { label: "Done", variant: "success" },
};

export function SectionStatusBadge({ status }: { status: SectionStatus }) {
  const { label, variant } = STATUS_BADGE[status];
  return <Badge variant={variant}>{label}</Badge>;
}

/** Display name of the signed-in user for sign-offs ("Reconciled by …"). */
export function useCloseActor(): string {
  const user = useAppSelector((state) => state.auth.user?.data?.user);
  const name = `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();
  return name || user?.email || "You";
}

/** Contributors are preparers; anyone above that holds "Manage periods". */
export function useCanManagePeriods(): { canManage: boolean; companyName: string } {
  const connections = useAppSelector((state) => state.quickBooks.connections);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const active = connections.length === 1 ? connections[0] : connections.find((c) => c._id === qbConnectionId);
  return { canManage: active?.role !== "contributor", companyName: active?.name ?? "this company" };
}
