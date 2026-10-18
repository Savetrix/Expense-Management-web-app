// Archive types and fixed labels. Archived records come from the backend
// once the archive API exists; merge candidates come from real pending invoices.

export type ArchiveReason = "duplicate" | "notTransaction" | "merged" | "splitOriginal";
export type DocumentSource = "Email" | "Upload" | "WhatsApp";
export type MatchFieldLabel = "Vendor" | "Amount" | "Date" | "Reference";

export interface MatchField {
  label: MatchFieldLabel;
  thisValue: string;
  existingValue: string;
}

export interface ArchivedDocument {
  id: string;
  fileName: string;
  vendor?: string;
  /** ISO timestamp the document arrived. */
  receivedAt: string;
  source: DocumentSource;
  reason: ArchiveReason;
  reasonText: string;
  amount?: number;
  currency?: string;
  duplicate?: {
    existingReference: string;
    existingFileName: string;
    fields: MatchField[];
  };
}

export interface UnpostedInvoice {
  id: string;
  reference: string;
  vendor: string;
  /** ISO date printed on the document. */
  date: string;
  amount: number;
  currency: string;
  fileName: string;
  attachments: number;
}

export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  duplicate: "Duplicate",
  notTransaction: "Not a transaction",
  merged: "Merged",
  splitOriginal: "Split original",
};
