import { formatDetailAmount } from "@/lib/invoiceDetailTheme";

import type { PaperworkRequest } from "./types";

export const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
export const FIELD_INPUT_CLASS =
  "mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";
export const FIELD_TEXTAREA_CLASS =
  "mt-[var(--space-xs)] min-h-[96px] w-full rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40";
export const ROW_ACTION_CLASS =
  "flex h-8 shrink-0 items-center gap-[var(--space-xs)] rounded-md bg-accent/10 px-[var(--space-sm)] text-caption font-bold text-accent disabled:cursor-not-allowed disabled:opacity-60";

export const money = (amount?: number) => (amount === undefined ? "" : formatDetailAmount(amount));

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatDate(ymd?: string): string {
  if (!ymd) return "";
  const d = parseYmd(ymd);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Whole days from today to `ymd` (negative when it's in the past). */
export function daysUntil(ymd: string): number {
  return Math.round((parseYmd(ymd).getTime() - startOfToday().getTime()) / 86_400_000);
}

export function isOverdue(request: PaperworkRequest): boolean {
  return request.status === "open" && daysUntil(request.dueDate) < 0;
}

export function dueText(ymd: string): string {
  const days = daysUntil(ymd);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
}

export function receivedCount(request: PaperworkRequest): number {
  return request.items.filter((i) => i.status === "received").length;
}

export interface ReminderSlot {
  label: string;
  date: Date;
  /** True when the slot falls on or before the send date, so it won't be sent. */
  skipped: boolean;
}

/** The automatic chase schedule for a request sent today and due on `dueYmd`. */
export function reminderSchedule(dueYmd: string): ReminderSlot[] {
  const today = startOfToday();
  const due = parseYmd(dueYmd);
  const shift = (base: Date, days: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  };
  const slots: Omit<ReminderSlot, "skipped">[] = [
    { label: "1 day after sending", date: shift(today, 1) },
    { label: "14 days before due", date: shift(due, -14) },
    { label: "7 days before due", date: shift(due, -7) },
    { label: "2 days before due", date: shift(due, -2) },
    { label: "1 day before due", date: shift(due, -1) },
    { label: "1 day after due", date: shift(due, 1) },
    { label: "2 days after due", date: shift(due, 2) },
    { label: "7 days after due", date: shift(due, 7) },
  ];
  return slots.map((s) => ({ ...s, skipped: s.date.getTime() <= today.getTime() }));
}

export const formatSlotDate = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
