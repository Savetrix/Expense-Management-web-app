// Types for the /supplier-statements page. Statements and their lines come
// from the backend (not wired yet); candidate bills are the user's real
// invoices from the invoice slice (see invoiceBills.ts).

export type StatementStatus = "processing" | "needs_matching" | "reconciled";

/** The four facts compared between a statement line and a bill. */
export type MatchField = "vendor" | "date" | "amount" | "reference";

/**
 * matched   — all four facts agree (or the user accepted / picked a match)
 * partial   — three of four agree; `differingField` says which one doesn't
 * unmatched — no bill found
 * missing   — the user confirmed there's no bill yet (invoice to be requested)
 */
export type LineMatchResult = "matched" | "partial" | "unmatched" | "missing";

/** A bill in Scantrix (an invoice from the invoice slice) a statement line can match. */
export interface CandidateBill {
  id: string;
  number: string;
  vendor: string;
  date: string; // YYYY-MM-DD, "" when the invoice has no date
  amount: number;
  currency?: string;
}

export interface StatementLine {
  id: string;
  date: string; // YYYY-MM-DD
  reference: string;
  amount: number;
  result: LineMatchResult;
  billId?: string;
  differingField?: MatchField;
  /** How a matched line got matched — shown as a small hint in the table. */
  matchedBy?: "auto" | "accepted" | "manual";
}

export interface SupplierStatement {
  id: string;
  vendor: string;
  statementDate: string;
  periodStart: string;
  periodEnd: string;
  /** Read from the statement by the backend; undefined until then. */
  currency?: string;
  /** Closing balance printed on the statement. */
  balance: number;
  status: StatementStatus;
  source: "Upload" | "Email";
  fileName: string;
  lines: StatementLine[];
}
