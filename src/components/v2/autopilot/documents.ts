import { getUserDisplayName } from "@/lib/invoiceDisplay";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";
import type { GLAccount } from "@/store/quickBooks/quickBooksSlice";

import type { AutopilotDocument, PublishedBy } from "./types";

/** Maps a real invoice to the shape the Autopilot lists and modal render. */
export function toAutopilotDocument(
  invoice: InvoiceRecord,
  accounts: GLAccount[],
  publishedBy?: PublishedBy,
): AutopilotDocument {
  const data = invoice.extractedData;
  const glId = data?.glAccountId ? String(data.glAccountId) : "";
  const history = invoice.statusHistory;
  const lastChange = history && history.length > 0 ? history[history.length - 1] : undefined;
  const person = getUserDisplayName(invoice.quickbooks?.postedBy);
  return {
    id: invoice._id,
    reference: data?.invoiceNumber || "No reference",
    vendor: data?.vendorName || "Unknown vendor",
    date: data?.invoiceDate,
    total: data?.totalAmount,
    currency: data?.currency,
    glAccount: glId ? accounts.find((a) => a.qbAccountId === glId)?.name : undefined,
    publishedBy,
    publishedByName: publishedBy === "person" ? person || undefined : undefined,
    publishedAt: publishedBy ? invoice.quickbooks?.postedAt || lastChange?.changedAt || invoice.updatedAt : undefined,
  };
}
