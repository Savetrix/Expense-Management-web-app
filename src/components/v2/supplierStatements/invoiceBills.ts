import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

import type { CandidateBill } from "./types";

function toYmd(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

/** Maps the invoices already loaded in the invoice slice to matchable bills. */
export function invoicesToBills(invoices: InvoiceRecord[]): CandidateBill[] {
  return invoices.map((invoice) => {
    const data = invoice.extractedData ?? {};
    return {
      id: invoice._id,
      number: data.invoiceNumber?.trim() || "No number",
      vendor: data.vendorName?.trim() || "",
      date: toYmd(data.invoiceDate),
      amount: Number(data.totalAmount ?? 0) || 0,
      currency: data.currency || undefined,
    };
  });
}

/** Distinct vendor names on the user's invoices, for the upload vendor picker. */
export function vendorNamesFrom(bills: CandidateBill[]): string[] {
  return Array.from(new Set(bills.map((b) => b.vendor).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function sameVendor(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
