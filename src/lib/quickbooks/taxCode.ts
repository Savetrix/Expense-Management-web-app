import type { TaxCode } from "@/store/quickBooks/quickBooksSlice";

// TaxCode's shape varies by environment (see quickBooksSlice.ts) — fall back
// across every field name the live API and older shapes have used.
export const taxCodeId = (taxCode: TaxCode) =>
  taxCode.id || taxCode.qbTaxCodeId || taxCode.Id || taxCode._id || "";

export const taxCodeName = (taxCode: TaxCode) =>
  taxCode.name || taxCode.Name || taxCodeId(taxCode);

// 12 → "12%", 9.975 → "9.975%". null/undefined → "" (rate unknown — show nothing rather than a misleading 0%).
export const formatTaxRate = (rate?: number | null) =>
  rate == null || !Number.isFinite(rate) ? "" : `${Number(rate.toFixed(3))}%`;

// Display-only label, e.g. "HST BC (12%)". Deliberately separate from
// taxCodeName(), which search/filter/chatbot code matches against by name.
export const taxCodeLabel = (taxCode: TaxCode) => {
  const rate = formatTaxRate(taxCode.totalRate);
  return rate ? `${taxCodeName(taxCode)} (${rate})` : taxCodeName(taxCode);
};
