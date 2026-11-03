import { formatDetailAmount } from "@/lib/invoiceDetailTheme";
import type { ClaimStatus, ExpenseRequestError } from "@/store/expenseClaims/expenseClaimsApi";

export const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
export const CARD_CLASS = "overflow-hidden rounded-lg border border-border bg-surface shadow-sm";
export const TOOLBAR_CLASS = "flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center";

export const money = (amount: number, currency?: string | null) => formatDetailAmount(amount, currency ?? undefined);

/** Day-only business dates — parsed as local midnight so they never shift a day. */
export function shortDate(date?: string | null): string {
  if (!date) return "—";
  const day = date.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00`);
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

export const CLAIM_STATUS_META: Record<ClaimStatus, { label: string; variant: "success" | "warning" | "neutral" }> = {
  awaiting_review: { label: "Awaiting review", variant: "warning" },
  awaiting_reimbursement: { label: "Awaiting reimbursement", variant: "neutral" },
  paid: { label: "Paid", variant: "success" },
};

// Mirrors the backend's role matrix (Scantrix_API src/constants/permissions.js):
// APPROVE_POST_QBO / REVIEW_EDIT_GL = owner, admin, accountant; ASSIGN_ROLES =
// owner, admin. Contributors are "submitters": their own claims and journeys
// only. Hiding a button is convenience — the backend checks every action.
export type CompanyRole = "owner" | "admin" | "accountant" | "contributor" | "";
export const isApprover = (role: CompanyRole) => role === "owner" || role === "admin" || role === "accountant";
export const canChangeSelfApproval = (role: CompanyRole) => role === "owner" || role === "admin";

export const errorMessage = (payload: unknown, fallback: string) =>
  (payload as ExpenseRequestError | undefined)?.message || fallback;
