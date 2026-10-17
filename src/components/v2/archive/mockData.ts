// SAMPLE DATA ONLY — Archive & Duplicates has no backend yet. /archive
// renders from these fixtures until the archive API exists; replace each
// export with the matching fetch once the endpoints land.

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

export const ARCHIVED_DOCUMENTS: ArchivedDocument[] = [
  {
    id: "ar-1",
    fileName: "metro-office-INV-1042-copy.pdf",
    vendor: "Metro Office Supplies",
    receivedAt: "2026-10-16T08:14:00Z",
    source: "Email",
    reason: "duplicate",
    reasonText: "Duplicate of INV-1042 — vendor, amount, date and reference match",
    amount: 186.4,
    currency: "CAD",
    duplicate: {
      existingReference: "INV-1042",
      existingFileName: "INV-1042.pdf",
      fields: [
        { label: "Vendor", thisValue: "Metro Office Supplies", existingValue: "Metro Office Supplies" },
        { label: "Amount", thisValue: "CAD 186.40", existingValue: "CAD 186.40" },
        { label: "Date", thisValue: "Oct 12, 2026", existingValue: "Oct 12, 2026" },
        { label: "Reference", thisValue: "INV-1042", existingValue: "INV-1042" },
      ],
    },
  },
  {
    id: "ar-2",
    fileName: "IMG_20261015_receipt.jpg",
    vendor: "Fuel Stop 24",
    receivedAt: "2026-10-15T19:40:00Z",
    source: "WhatsApp",
    reason: "duplicate",
    reasonText: "Likely duplicate of R-55810 — 3 of 4 details match, confirmed by comparing the documents",
    amount: 71.35,
    currency: "CAD",
    duplicate: {
      existingReference: "R-55810",
      existingFileName: "fuelstop-scan-oct.pdf",
      fields: [
        { label: "Vendor", thisValue: "Fuel Stop 24", existingValue: "Fuel Stop 24" },
        { label: "Amount", thisValue: "CAD 71.35", existingValue: "CAD 71.35" },
        { label: "Date", thisValue: "Oct 9, 2026", existingValue: "Oct 9, 2026" },
        { label: "Reference", thisValue: "55810", existingValue: "R-55810" },
      ],
    },
  },
  {
    id: "ar-3",
    fileName: "cloud-desk-receipt-sept.pdf",
    vendor: "CloudDesk Software",
    receivedAt: "2026-10-03T07:02:00Z",
    source: "Email",
    reason: "duplicate",
    reasonText: "Payment receipt for invoice SUB-09/26 already in Scantrix",
    amount: 299,
    currency: "CAD",
    duplicate: {
      existingReference: "SUB-09/26",
      existingFileName: "SUB-09-26.pdf",
      fields: [
        { label: "Vendor", thisValue: "CloudDesk Software", existingValue: "CloudDesk Software" },
        { label: "Amount", thisValue: "CAD 299.00", existingValue: "CAD 299.00" },
        { label: "Date", thisValue: "Oct 1, 2026", existingValue: "Sep 30, 2026" },
        { label: "Reference", thisValue: "PAY-77812", existingValue: "SUB-09/26" },
      ],
    },
  },
  {
    id: "ar-4",
    fileName: "October product news.html",
    receivedAt: "2026-10-14T12:30:00Z",
    source: "Email",
    reason: "notTransaction",
    reasonText: "Not a financial document: newsletter",
  },
  {
    id: "ar-5",
    fileName: "delivery-note-4471.pdf",
    vendor: "Brightline Electrical",
    receivedAt: "2026-10-12T10:18:00Z",
    source: "Upload",
    reason: "notTransaction",
    reasonText: "Not a financial document: delivery note with no amounts",
  },
  {
    id: "ar-6",
    fileName: "IMG_0931.jpg",
    receivedAt: "2026-10-11T17:55:00Z",
    source: "WhatsApp",
    reason: "notTransaction",
    reasonText: "Not a financial document: photo with no readable text",
  },
  {
    id: "ar-7",
    fileName: "northside-INV-2201-page2.pdf",
    vendor: "Northside Packaging Ltd",
    receivedAt: "2026-10-10T09:00:00Z",
    source: "Upload",
    reason: "merged",
    reasonText: "Merged into INV-2201",
  },
  {
    id: "ar-8",
    fileName: "september-supplier-bills.pdf",
    receivedAt: "2026-10-02T14:22:00Z",
    source: "Email",
    reason: "splitOriginal",
    reasonText: "Original multi-invoice PDF, split into 3",
  },
];

export const UNPOSTED_INVOICES: UnpostedInvoice[] = [
  { id: "up-1", reference: "INV-3310", vendor: "Harbor Linen Services", date: "2026-10-14", amount: 1240, currency: "CAD", fileName: "INV-3310.pdf", attachments: 1 },
  { id: "up-2", reference: "INV-3310 (p.2)", vendor: "Harbor Linen Services", date: "2026-10-14", amount: 0, currency: "CAD", fileName: "INV-3310-page-2.jpg", attachments: 1 },
  { id: "up-3", reference: "TS-3310", vendor: "Harbor Linen Services", date: "2026-10-14", amount: 0, currency: "CAD", fileName: "timesheet-oct.pdf", attachments: 1 },
  { id: "up-4", reference: "Q-8820", vendor: "Brightline Electrical", date: "2026-10-12", amount: 2310, currency: "CAD", fileName: "brightline-quote-accepted.pdf", attachments: 2 },
  { id: "up-5", reference: "R-2291", vendor: "Bean There Coffee", date: "2026-10-13", amount: 42.6, currency: "CAD", fileName: "IMG_2291.jpg", attachments: 1 },
];
