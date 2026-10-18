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
