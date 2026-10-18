// Autopilot types and fixed configuration. No records live here: Needs review
// and Autopublished are derived from the real invoice slice, and AI memories /
// usage rows arrive from the backend once those endpoints exist.

export type PublishedBy = "autopilot" | "person";

/** One invoice as Autopilot shows it, derived from an InvoiceRecord. */
export interface AutopilotDocument {
  /** The invoice's `_id`. */
  id: string;
  reference: string;
  vendor: string;
  /** Date printed on the document, when it was read. */
  date?: string | null;
  total?: number;
  currency?: string;
  /** GL account name, when the invoice has one and it's in the synced chart of accounts. */
  glAccount?: string;
  publishedBy?: PublishedBy;
  publishedByName?: string;
  /** ISO timestamp the document was published. */
  publishedAt?: string;
}

export type MemoryStatus = "proposed" | "active";

export interface AiMemory {
  id: string;
  rule: string;
  scope: string;
  status: MemoryStatus;
  source: string;
}

export const MEMORY_SCOPES = ["All documents", "One vendor", "One uploader", "Receipts only"] as const;

export type UsageRange = "thisMonth" | "lastMonth" | "last90";

export const USAGE_RANGE_LABELS: Record<UsageRange, string> = {
  thisMonth: "This month",
  lastMonth: "Last month",
  last90: "Last 90 days",
};

export interface UsageRow {
  id: string;
  name: string;
  processed: number;
  published: number;
  autopublished: number;
  adjustments: number;
}
