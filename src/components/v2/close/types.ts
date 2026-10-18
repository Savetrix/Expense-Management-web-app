// Shapes for the month-end close (working papers). The close API does not
// exist yet, so a working paper only carries the period it covers; every
// section's figures are read from the accounting software by the backend (BE).

export type SectionKey = "invoices" | "adjustments" | "payablesReceivables" | "fixedAssets" | "balanceSheet";
/** "waiting" = the section has no real data source yet, so it can't count as done. */
export type SectionStatus = "waiting" | "todo" | "in_progress" | "done";

export interface SignOff {
  by: string;
  at: string; // ISO timestamp
  justification?: string;
}

export interface WorkingPaper {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  createdBy: string;
  touched: Partial<Record<SectionKey, boolean>>;
  closedBy?: string;
  closedAt?: string;
}
