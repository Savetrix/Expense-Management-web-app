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

/** Closest first: smallest amount difference (money in or out compared by size), then nearest date. */
export function rankInvoices(txn: Pick<BankTransaction, "amount" | "date">, candidates: InvoiceCandidate[]): InvoiceCandidate[] {
  const size = Math.abs(txn.amount);
  const diff = (c: InvoiceCandidate) => (c.total === null ? Number.POSITIVE_INFINITY : Math.abs(Math.abs(c.total) - size));
  return [...candidates].sort((a, b) => diff(a) - diff(b) || daysApart(a.date, txn.date) - daysApart(b.date, txn.date));
}

/** True when the amounts agree to the cent. */
export function isExactAmount(txn: Pick<BankTransaction, "amount">, c: InvoiceCandidate): boolean {
  return c.total !== null && Math.round(Math.abs(c.total) * 100) === Math.round(Math.abs(txn.amount) * 100);
}

/** Strong = same amount to the cent AND dated within 7 days of the bank line. */
export function isStrongMatch(txn: Pick<BankTransaction, "amount" | "date">, c: InvoiceCandidate): boolean {
  return isExactAmount(txn, c) && daysApart(c.date, txn.date) <= 7;
}

export interface StrongSuggestion {
  txn: BankTransaction;
  invoice: InvoiceCandidate;
}

/**
 * For each money-out line still to review, its best-ranked bill when that bill is a
 * strong match. A bill is offered to one line only, and never when another
 * line is already matched to it.
 */
export function findStrongSuggestions(txns: BankTransaction[], candidates: InvoiceCandidate[]): StrongSuggestion[] {
  const taken = new Set(txns.filter((t) => t.status === "matched" && t.matchedInvoiceId).map((t) => t.matchedInvoiceId as string));
  const free = candidates.filter((c) => !taken.has(c.id));
  const out: StrongSuggestion[] = [];
  for (const txn of txns) {
    // Only money out pays a bill; a deposit of the same amount is not a match.
    if (txn.status !== "review" || txn.amount >= 0) continue;
    const best = rankInvoices(txn, free.filter((c) => !taken.has(c.id)))[0];
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
