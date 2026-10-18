import { formatDetailAmount } from "@/lib/invoiceDetailTheme";

import type { ClaimReceipt, ClaimStatus, Journey } from "./types";

export const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
export const FIELD_INPUT_CLASS =
  "mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";
export const CARD_CLASS = "overflow-hidden rounded-lg border border-border bg-surface shadow-sm";
export const TOOLBAR_CLASS = "flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center";

/** No currency code: the connection does not carry one, so amounts show as plain numbers. */
export const money = (amount: number) => formatDetailAmount(amount);

/** Day-only business dates — parsed as local midnight so they never shift a day. */
export function shortDate(date?: string): string {
  if (!date) return "—";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function monthLabel(month: string): string {
  const parsed = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return month;
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const claimTotal = (receipts: ClaimReceipt[]) => receipts.reduce((sum, r) => sum + r.amount, 0);
export const claimTax = (receipts: ClaimReceipt[]) => receipts.reduce((sum, r) => sum + r.tax, 0);

export const journeyAmount = (j: Pick<Journey, "km" | "rate" | "passenger" | "passengerRate">) =>
  Math.round(j.km * (j.rate + (j.passenger ? j.passengerRate : 0)) * 100) / 100;

export const CLAIM_STATUS_META: Record<ClaimStatus, { label: string; variant: "success" | "warning" | "neutral" }> = {
  awaiting_review: { label: "Awaiting review", variant: "warning" },
  awaiting_reimbursement: { label: "Awaiting reimbursement", variant: "neutral" },
  paid: { label: "Paid", variant: "success" },
};

let idCounter = 0;
/** Local-only id for records that only exist in this session until the backend stores them. */
export const localId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
