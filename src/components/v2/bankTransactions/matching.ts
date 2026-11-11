import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

import type { BankTransaction, InvoiceCandidate } from "./types";

const DAY_MS = 86_400_000;

export function toCandidates(...lists: InvoiceRecord[][]): InvoiceCandidate[] {
  const seen = new Set<string>();
  const out: InvoiceCandidate[] = [];
  for (const list of lists) {
    for (const inv of list) {
      if (!inv?._id || seen.has(inv._id)) continue;
      seen.add(inv._id);
      const d = inv.extractedData;
      out.push({
        id: inv._id,
        vendor: d?.vendorName || "Unknown vendor",
        number: d?.invoiceNumber || "",
        date: (d?.invoiceDate || inv.createdAt || "").slice(0, 10),
        total: typeof d?.totalAmount === "number" ? d.totalAmount : null,
        billId: inv.quickbooks?.billId || null,
        glAccountId: d?.glAccountId || null,
        taxCodeId: d?.taxCodeId || null,
      });
    }
  }
  return out;
}

function daysApart(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isNaN(ta) || Number.isNaN(tb) ? Number.POSITIVE_INFINITY : Math.abs(ta - tb) / DAY_MS;
}

// Words that say nothing about who the vendor is.
const FILLER = new Set([
  "the", "and", "of", "inc", "incorporated", "ltd", "limited", "llc", "llp", "plc", "co", "corp", "corporation",
  "company", "pvt", "private", "pty", "gmbh", "sa", "bv", "group", "holdings",
]);
const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !FILLER.has(w));

/**
 * True when the bank line's text names the bill's vendor: the vendor's first
 * real word ("Uber" in "Uber Technologies Inc") is a word in the bank text,
 * or the whole name, without spaces, is in it ("HOMEDEPOT" for "Home Depot").
 * Bank text is often short or coded ("AMZN MKTP"), so false is common and
 * only means "can't tell", not "a different vendor".
 */
export function vendorAgrees(txn: Pick<BankTransaction, "description" | "payee" | "merchantName">, c: Pick<InvoiceCandidate, "vendor">): boolean {
  const vendor = words(c.vendor);
  if (vendor.length === 0 || c.vendor === "Unknown vendor") return false;
  const bank = words(`${txn.merchantName ?? ""} ${txn.payee ?? ""} ${txn.description}`);
  if (bank.length === 0) return false;
  if (vendor[0].length >= 3 && bank.includes(vendor[0])) return true;
  const compact = vendor.join("");
  return compact.length >= 4 && bank.join("").includes(compact);
}

type MatchableLine = Pick<BankTransaction, "amount" | "date" | "description" | "payee" | "merchantName">;

/**
 * Closest first: smallest amount difference (money in or out compared by size),
 * then a bill from the vendor the bank text names, then nearest date.
 */
export function rankInvoices(txn: MatchableLine, candidates: InvoiceCandidate[]): InvoiceCandidate[] {
  const size = Math.abs(txn.amount);
  const diff = (c: InvoiceCandidate) => (c.total === null ? Number.POSITIVE_INFINITY : Math.abs(Math.abs(c.total) - size));
  const named = new Map(candidates.map((c) => [c.id, vendorAgrees(txn, c) ? 0 : 1]));
  return [...candidates].sort(
    (a, b) => diff(a) - diff(b) || (named.get(a.id) ?? 1) - (named.get(b.id) ?? 1) || daysApart(a.date, txn.date) - daysApart(b.date, txn.date),
  );
}

/** True when the amounts agree to the cent. */
export function isExactAmount(txn: Pick<BankTransaction, "amount">, c: InvoiceCandidate): boolean {
  return c.total !== null && Math.round(Math.abs(c.total) * 100) === Math.round(Math.abs(txn.amount) * 100);
}

/** Strong = same amount to the cent, dated within 7 days of the bank line, AND the bank text names the bill's vendor. */
export function isStrongMatch(txn: MatchableLine, c: InvoiceCandidate): boolean {
  return isExactAmount(txn, c) && daysApart(c.date, txn.date) <= 7 && vendorAgrees(txn, c);
}

/**
 * Bills that can't be paid by a bank line any more: matched to a line already
 * (one line per bill, the server refuses a second), or with nothing left to
 * pay in QuickBooks/Xero (`paidBillIds`, the provider's own bill ids).
 */
export function closedBills(txns: BankTransaction[], candidates: InvoiceCandidate[], paidBillIds: ReadonlySet<string>): Set<string> {
  const out = new Set(txns.filter((t) => t.status === "matched" && t.matchedInvoiceId).map((t) => t.matchedInvoiceId as string));
  for (const c of candidates) if (c.billId && paidBillIds.has(c.billId)) out.add(c.id);
  return out;
}

/** The bills a line may be matched to: open ones, plus the one it is matched to now. */
export function billsFor(txn: Pick<BankTransaction, "matchedInvoiceId">, candidates: InvoiceCandidate[], closed: ReadonlySet<string>): InvoiceCandidate[] {
  return candidates.filter((c) => c.id === txn.matchedInvoiceId || !closed.has(c.id));
}

export interface StrongSuggestion {
  txn: BankTransaction;
  invoice: InvoiceCandidate;
}

/**
 * For each money-out line still to review, its best-ranked bill when that bill is a
 * strong match. A bill is offered to one line only, and never when it is
 * closed (see closedBills).
 */
export function findStrongSuggestions(txns: BankTransaction[], candidates: InvoiceCandidate[], closed: ReadonlySet<string> = new Set()): StrongSuggestion[] {
  const taken = new Set(closed);
  for (const t of txns) if (t.status === "matched" && t.matchedInvoiceId) taken.add(t.matchedInvoiceId);
  const out: StrongSuggestion[] = [];
  for (const txn of txns) {
    // Only money out pays a bill; a deposit of the same amount is not a match.
    if (txn.status !== "review" || txn.amount >= 0) continue;
    const best = rankInvoices(txn, candidates.filter((c) => !taken.has(c.id)))[0];
    if (best && isStrongMatch(txn, best)) {
      taken.add(best.id);
      out.push({ txn, invoice: best });
    }
  }
  return out;
}

/** Link into the paperwork-request wizard, pre-filled from a money-out bank line. */
export function paperworkHref(txn: Pick<BankTransaction, "description" | "amount" | "date">): string {
  const params = new URLSearchParams({
    new: "1",
    item: txn.description,
    amount: String(Math.round(Math.abs(txn.amount) * 100) / 100),
    date: txn.date,
  });
  return `/requests?${params.toString()}`;
}
