import { formatDetailAmount } from "@/lib/invoiceDetailTheme";

import { MOCK_CURRENCY, type ApprovalRules, type Bill, type RunStatus, type TeamMember } from "./mockData";

export const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
export const CARD_CLASS = "overflow-hidden rounded-lg border border-border bg-surface shadow-sm";
export const TOOLBAR_CLASS = "flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center";

export const money = (amount: number) => formatDetailAmount(amount, MOCK_CURRENCY);

/** Day-only business dates — parsed as local midnight so they never shift a day. */
export function shortDate(date?: string): string {
  if (!date) return "—";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const isOverdue = (bill: Pick<Bill, "dueDate">) => bill.dueDate < todayIso();

export const maskNumber = (value: string, visible = 4) => `•••• ${value.slice(-visible)}`;

export const sumAmounts = (rows: { amount: number }[]) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;

/** Whether a bill needs sign-off before it can be paid under the current rules. */
export function needsApproval(bill: Bill, rules: ApprovalRules): boolean {
  if (!rules.enabled || bill.approved || rules.approverIds.length === 0) return false;
  return rules.mode === "every" ? true : bill.amount > rules.threshold;
}

export const approverNames = (rules: ApprovalRules, team: TeamMember[]) =>
  rules.approverIds.map((id) => team.find((m) => m.id === id)?.name ?? id).join(", ") || "an approver";

export const RUN_STATUS_META: Record<RunStatus, { label: string; variant: "success" | "warning" | "error" | "neutral" }> = {
  waiting_authorisation: { label: "Waiting for authorisation", variant: "warning" },
  processing: { label: "Processing", variant: "neutral" },
  paid: { label: "Paid", variant: "success" },
  failed: { label: "Failed", variant: "error" },
};

export const delay = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

let idCounter = 0;
export const mockId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
