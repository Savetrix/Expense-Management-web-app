"use client";

import { Badge } from "@/components/ui/Badge";
import { formatDetailAmount, formatDetailDate, formatDetailDateTime } from "@/lib/invoiceDetailTheme";
import { formatPlainDate } from "@/lib/plainDate";
import { useAppSelector } from "@/store/hooks";

import type { SectionKey, SectionStatus, SignOff } from "./types";

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

/** What the checklist knows about real data; null = not loaded (yet). */
export interface CloseDataContext {
  /** Real pending invoices dated on or before period end, or null while unknown. */
  pendingInvoiceCount: number | null;
}

/** Only section 1 has a real source today; every other section waits for the backend (BE). */
export function sectionStatus(key: SectionKey, ctx: CloseDataContext, touched: boolean): SectionStatus {
  if (key !== "invoices" || ctx.pendingInvoiceCount === null) return "waiting";
  if (ctx.pendingInvoiceCount === 0) return "done";
  return touched ? "in_progress" : "todo";
}

const STATUS_BADGE: Record<SectionStatus, { label: string; variant: "success" | "warning" | "neutral" }> = {
  waiting: { label: "Waiting for data", variant: "neutral" },
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
