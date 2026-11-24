// "Bill not in QuickBooks yet" on a suggested match (24 Nov): one action posts
// the ScanTrix bill through the normal invoice posting path
// (postInvoiceToQuickBooks, with its own double-post guards), then sends the
// bank line as that bill's payment. A bill that isn't ready to post (vendor not
// resolved, a line without a GL account, on an expense claim...) is never
// posted from here: the line shows "Bill waiting in ScanTrix" with a link.
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

export interface BillPostPayload {
  invoiceId: string;
  vendorId: string;
  extractedData: {
    vendorName: string;
    currency: string;
    invoiceNumber: string;
    invoiceDate: string | null;
    dueDate: string | null;
    amountBeforeTax: number;
    taxAmount: number;
    totalAmount: number;
    glAccountId: string | null;
    taxCodeId: string | null;
    lineItems: NonNullable<NonNullable<InvoiceRecord["extractedData"]>["lineItems"]>;
    extraCharges: NonNullable<NonNullable<InvoiceRecord["extractedData"]>["extraCharges"]>;
    description: string | null;
  };
}

export type BillReadiness = { ok: true; payload: BillPostPayload } | { ok: false; reason: string };

/** Whether the bill can be posted as it is saved, and the payload the invoice screen would send. */
export function billReadiness(inv: InvoiceRecord | undefined): BillReadiness {
  if (!inv) return { ok: false, reason: "The bill isn't loaded." };
  if (inv.quickbooks?.billId || inv.postedStatus === "auto" || inv.postedStatus === "manual") return { ok: false, reason: "The bill is already posted." };
  if (inv.rejectedAt) return { ok: false, reason: "The bill was rejected." };
  if (inv.expenseClaimId || inv.claimReceipt) return { ok: false, reason: "The bill is on a reimbursement claim." };
  const d = inv.extractedData;
  const vendorId = inv.vendor?.resolutionStatus === "exact" ? inv.vendor.vendorDbId : undefined;
  if (!vendorId) return { ok: false, reason: "Its vendor isn't confirmed yet." };
  if (!d || !(typeof d.totalAmount === "number" && d.totalAmount > 0)) return { ok: false, reason: "Its total is missing." };
  if (!d.invoiceNumber?.trim()) return { ok: false, reason: "Its invoice number is missing." };
  if (!d.currency?.trim()) return { ok: false, reason: "Its currency is missing." };
  const lines = d.lineItems ?? [];
  const top = d.glAccountId || null;
  if (lines.length === 0 ? !top : lines.some((l) => !((l as { glAccountId?: string | null }).glAccountId || top))) {
    return { ok: false, reason: "A line has no GL account yet." };
  }
  return {
    ok: true,
    payload: {
      invoiceId: inv._id,
      vendorId,
      extractedData: {
        vendorName: d.vendorName ?? "",
        currency: d.currency,
        invoiceNumber: d.invoiceNumber,
        invoiceDate: d.invoiceDate || null,
        dueDate: d.dueDate || null,
        amountBeforeTax: Number(d.amountBeforeTax) || 0,
        taxAmount: Number(d.taxAmount) || 0,
        totalAmount: d.totalAmount,
        glAccountId: top,
        taxCodeId: d.taxCodeId || null,
        lineItems: lines,
        // Extra charges post as non-taxable, as on the invoice screen.
        extraCharges: (d.extraCharges ?? []).map((c) => ({ ...c, taxCodeId: null })),
        description: null,
      },
    },
  };
}
