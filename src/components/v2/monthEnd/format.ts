import { formatDetailAmount } from "@/lib/invoiceDetailTheme";

import type { PrepaymentDisplayStatus } from "@/store/monthEnd/monthEndApi";

// Display helpers for the month-end trackers. The schedule maths itself is
// the backend's (Scantrix_API utils/prepayment_schedule.js) — the page only
// shows what it returns.

/** Parses YYYY-MM-DD as a UTC date so local time zones never shift the day. */
function parseIso(iso: string | null | undefined): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dateLabel(iso: string | null | undefined): string {
  const d = parseIso(iso);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
}

export function rangeLabel(startIso: string, endIso: string): string {
  return `${dateLabel(startIso)} – ${dateLabel(endIso)}`;
}

/** "13–30 Nov 2026", or "Dec 2026" for a whole month. */
export function periodCoveredLabel(start: string, end: string, days: number): string {
  const s = parseIso(start);
  const e = parseIso(end);
  if (!s || !e) return "—";
  const month = s.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const lastDay = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate();
  if (s.getUTCDate() === 1 && e.getUTCDate() === lastDay) return month;
  return `${s.getUTCDate()}–${e.getUTCDate()} ${month} (${days} day${days === 1 ? "" : "s"})`;
}

export function formatMoney(amount: number, currency?: string | null): string {
  return formatDetailAmount(amount, currency ?? undefined);
}

export const STATUS_LABELS: Record<PrepaymentDisplayStatus, string> = {
  review: "To review",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};
