// Which tab a bank line sits in, and the date filter's periods. Pure, so it is
// tested without a screen (src/test/bankListView.test.ts).
//
// Tabs (Saurabh, 20 Nov): "Ready to post" listed lines already sent to
// QuickBooks/Xero, which read as "waiting to be posted". Now:
//   To review            — lines still to handle, including a line Post saved
//                          but that isn't in the books: it failed to send
//                          (shown with the reason, to retry) or sending is off
//   Posted               — lines in QuickBooks/Xero (or being sent now)
//   Matched              — lines matched to a bill
//   Transfers / Excluded — transfers between own accounts, and excluded lines
//   All
import type { BankTransaction } from "./types";

export type ListTab = "review" | "posted" | "matched" | "transfers" | "all";

export const TAB_LABEL: Record<ListTab, string> = {
  review: "To review",
  posted: "Posted",
  matched: "Matched",
  transfers: "Transfers / Excluded",
  all: "All",
};

export function tabOf(t: Pick<BankTransaction, "status" | "postingStatus">): Exclude<ListTab, "all"> {
  if (t.status === "matched") return "matched";
  if (t.status === "transfer" || t.status === "excluded") return "transfers";
  if (t.status === "ready" && (t.postingStatus === "posted" || t.postingStatus === "processing")) return "posted";
  return "review";
}

export const inTab = (t: Pick<BankTransaction, "status" | "postingStatus">, tab: ListTab) => tab === "all" || tabOf(t) === tab;

// ------------------------------------------------------------------ dates

/** The date filter, QuickBooks style: full calendar periods before the current one. */
export type DatePeriod = "all" | "last_month" | "last_quarter" | "last_year" | "custom";

export const PERIOD_LABEL: Record<DatePeriod, string> = {
  all: "All dates",
  last_month: "Last month",
  last_quarter: "Last quarter",
  last_year: "Last year",
  custom: "Custom",
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** Last day of month m (0-based) in year y. */
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * The from–to dates ("YYYY-MM-DD", both included) of a period, from today's
 * date ("YYYY-MM-DD", the person's own calendar day). Last quarter is the
 * previous full calendar quarter: on 21 Nov that is 1 Jul – 30 Sep. "all" and
 * "custom" have no fixed range (custom uses the person's own dates).
 */
export function periodRange(period: DatePeriod, today: string): { from: string; to: string } | null {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  if (period === "last_month") {
    const py = m === 0 ? y - 1 : y;
    const pm = m === 0 ? 11 : m - 1;
    return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
  }
  if (period === "last_quarter") {
    const q = Math.floor(m / 3);
    const py = q === 0 ? y - 1 : y;
    const start = (q === 0 ? 3 : q - 1) * 3;
    return { from: iso(py, start, 1), to: iso(py, start + 2, lastDay(py, start + 2)) };
  }
  if (period === "last_year") return { from: iso(y - 1, 0, 1), to: iso(y - 1, 11, 31) };
  return null;
}

/** Today in the person's own calendar (not UTC): "YYYY-MM-DD". */
export function localToday(now = new Date()): string {
  return iso(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The dates a line must fall between, or null for no date filter. */
export function dateBounds(period: DatePeriod, custom: { from: string; to: string }, today: string): { from: string; to: string } | null {
  if (period === "custom") return custom.from || custom.to ? { from: custom.from, to: custom.to } : null;
  return periodRange(period, today);
}

export const inDates = (date: string, bounds: { from: string; to: string } | null) => !bounds || ((!bounds.from || date >= bounds.from) && (!bounds.to || date <= bounds.to));
