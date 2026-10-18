// Pure aggregation for the Reports page. Everything here works on the invoices
// already in Redux; nothing is fetched or invented. Amounts are NEVER summed
// across currencies: every total is keyed by currency code.
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

export type RangePreset = "this_month" | "last_month" | "last_3_months" | "this_year" | "all" | "custom";

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export const UNKNOWN_CURRENCY = "Unknown";
export const UNKNOWN_VENDOR = "Unknown vendor";
export const UNCODED = "Uncoded";
export const UNDATED = "undated";

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a business date. "YYYY-MM-DD" is local midnight (new Date() would
 *  read it as UTC and show the previous day west of Greenwich). */
export function parseDay(value?: string | null): Date | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = DAY_ONLY.exec(trimmed);
  const parsed = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** invoiceDate, falling back to createdAt. */
export function invoiceDay(invoice: InvoiceRecord): Date | null {
  return parseDay(invoice.extractedData?.invoiceDate) ?? parseDay(invoice.createdAt);
}

export function monthKey(date: Date | null): string {
  if (!date) return UNDATED;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  if (key === UNDATED) return "No date";
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function presetRange(preset: RangePreset, now: Date = new Date()): DateRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "this_month":
      return { from: new Date(y, m, 1), to: endOfDay(new Date(y, m + 1, 0)) };
    case "last_month":
      return { from: new Date(y, m - 1, 1), to: endOfDay(new Date(y, m, 0)) };
    case "last_3_months":
      return { from: new Date(y, m - 2, 1), to: endOfDay(new Date(y, m + 1, 0)) };
    case "this_year":
      return { from: new Date(y, 0, 1), to: endOfDay(new Date(y, 11, 31)) };
    default:
      return { from: null, to: null };
  }
}

/** Custom from/to inputs ("YYYY-MM-DD"); `to` is inclusive of the whole day. */
export function customRange(from: string, to: string): DateRange {
  const f = parseDay(from);
  const t = parseDay(to);
  return { from: f, to: t ? endOfDay(t) : null };
}

export function isPosted(invoice: InvoiceRecord): boolean {
  return invoice.postedStatus === "auto" || invoice.postedStatus === "manual";
}

export function isHeld(invoice: InvoiceRecord): boolean {
  return invoice.postedStatus === "pending" || invoice.postedStatus === "failed";
}

export function filterInvoices(
  invoices: InvoiceRecord[],
  opts: { range: DateRange; postedOnly: boolean },
): InvoiceRecord[] {
  const { range, postedOnly } = opts;
  const bounded = Boolean(range.from || range.to);
  return invoices.filter((invoice) => {
    if (postedOnly && !isPosted(invoice)) return false;
    if (!bounded) return true;
    const day = invoiceDay(invoice);
    if (!day) return false;
    if (range.from && day < range.from) return false;
    if (range.to && day > range.to) return false;
    return true;
  });
}

export function currencyOf(invoice: InvoiceRecord): string {
  return invoice.extractedData?.currency?.trim().toUpperCase() || UNKNOWN_CURRENCY;
}

export function vendorOf(invoice: InvoiceRecord): string {
  return invoice.extractedData?.vendorName?.trim() || UNKNOWN_VENDOR;
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Cents-safe addition so 0.1 + 0.2 style drift never reaches the screen. */
function add(a: number, b: number): number {
  return Math.round((a + b) * 100) / 100;
}

function currencyOrder(counts: Map<string, number>): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

// ---------- Spend by vendor / GL account: one row per (key, currency) ----------

export interface SpendRow {
  key: string;
  label: string;
  currency: string;
  count: number;
  total: number;
  average: number;
  /** 0-100 relative to the largest row in the same currency. */
  share: number;
}

interface RowAcc {
  key: string;
  label: string;
  currency: string;
  ids: Set<string>;
  total: number;
}

function finishRows(acc: Map<string, RowAcc>): SpendRow[] {
  const maxByCurrency = new Map<string, number>();
  const countByCurrency = new Map<string, number>();
  for (const row of acc.values()) {
    maxByCurrency.set(row.currency, Math.max(maxByCurrency.get(row.currency) ?? 0, row.total));
    countByCurrency.set(row.currency, (countByCurrency.get(row.currency) ?? 0) + row.ids.size);
  }
  const order = currencyOrder(countByCurrency);
  return [...acc.values()]
    .map((row) => {
      const max = maxByCurrency.get(row.currency) ?? 0;
      const count = row.ids.size;
      return {
        key: row.key,
        label: row.label,
        currency: row.currency,
        count,
        total: row.total,
        average: count ? Math.round((row.total / count) * 100) / 100 : 0,
        share: max > 0 ? (row.total / max) * 100 : 0,
      };
    })
    .sort(
      (a, b) =>
        order.indexOf(a.currency) - order.indexOf(b.currency) || b.total - a.total || a.label.localeCompare(b.label),
    );
}

function bump(acc: Map<string, RowAcc>, key: string, label: string, currency: string, id: string, amount: number) {
  const mapKey = `${currency}\u0000${key}`;
  const row = acc.get(mapKey) ?? { key, label, currency, ids: new Set<string>(), total: 0 };
  row.ids.add(id);
  row.total = add(row.total, amount);
  acc.set(mapKey, row);
}

export function groupByVendor(invoices: InvoiceRecord[]): SpendRow[] {
  const acc = new Map<string, RowAcc>();
  for (const inv of invoices) {
    const label = vendorOf(inv);
    bump(acc, label.toLowerCase(), label, currencyOf(inv), inv._id, num(inv.extractedData?.totalAmount));
  }
  return finishRows(acc);
}

/** `names` maps a GL account id (either the Scantrix _id or the accounting
 *  software's id) to its display name. Unresolvable ids collapse to "Uncoded".
 *  If an invoice's line items carry glAccountId the lines are grouped by their
 *  own amounts (a line without one falls back to the invoice-level account);
 *  otherwise the invoice total goes to the invoice-level account. */
export function groupByGlAccount(invoices: InvoiceRecord[], names: Record<string, string>): SpendRow[] {
  const acc = new Map<string, RowAcc>();
  const resolve = (id?: string | null) => {
    const name = id ? names[id] : undefined;
    return name ? { key: `id:${id}`, label: name } : { key: "uncoded", label: UNCODED };
  };
  for (const inv of invoices) {
    const data = inv.extractedData;
    const currency = currencyOf(inv);
    const lines = (data?.lineItems ?? []).filter((l) => l && typeof l === "object");
    if (lines.some((l) => l.glAccountId)) {
      for (const line of lines) {
        const target = resolve(line.glAccountId || data?.glAccountId);
        bump(acc, target.key, target.label, currency, inv._id, num(line.amount));
      }
    } else {
      const target = resolve(data?.glAccountId);
      bump(acc, target.key, target.label, currency, inv._id, num(data?.totalAmount));
    }
  }
  return finishRows(acc);
}

// ---------- Spend by month / tax: one row per month, money per currency ----------

export interface Money {
  count: number;
  pretax: number;
  tax: number;
  total: number;
}

export interface MonthRow {
  key: string;
  label: string;
  count: number;
  byCurrency: Record<string, Money>;
}

export function groupByMonth(invoices: InvoiceRecord[]): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const inv of invoices) {
    const key = monthKey(invoiceDay(inv));
    const row = map.get(key) ?? { key, label: monthLabel(key), count: 0, byCurrency: {} };
    const data = inv.extractedData;
    const total = num(data?.totalAmount);
    const tax = num(data?.taxAmount);
    // Pre-tax falls back to total - tax when the extractor left it empty.
    const pretax = data?.amountBeforeTax != null ? num(data.amountBeforeTax) : add(total, -tax);
    const money = row.byCurrency[currencyOf(inv)] ?? { count: 0, pretax: 0, tax: 0, total: 0 };
    money.count += 1;
    money.pretax = add(money.pretax, pretax);
    money.tax = add(money.tax, tax);
    money.total = add(money.total, total);
    row.byCurrency[currencyOf(inv)] = money;
    row.count += 1;
    map.set(key, row);
  }
  // Chronological, undated last.
  return [...map.values()].sort((a, b) =>
    a.key === UNDATED ? 1 : b.key === UNDATED ? -1 : a.key.localeCompare(b.key),
  );
}

/** Sum of a Money field per currency across month rows. */
export function totalsByCurrency(rows: MonthRow[], field: keyof Money): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const [currency, money] of Object.entries(row.byCurrency)) {
      out[currency] = add(out[currency] ?? 0, money[field]);
    }
  }
  return out;
}

export function currenciesOf(rows: MonthRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const [currency, money] of Object.entries(row.byCurrency)) {
      counts.set(currency, (counts.get(currency) ?? 0) + money.count);
    }
  }
  return currencyOrder(counts);
}

export function summarize(invoices: InvoiceRecord[]) {
  return {
    invoices: invoices.length,
    vendors: new Set(invoices.map((i) => vendorOf(i).toLowerCase())).size,
    posted: invoices.filter(isPosted).length,
    held: invoices.filter(isHeld).length,
  };
}
