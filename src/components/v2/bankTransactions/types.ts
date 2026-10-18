export type BankTxnStatus = "review" | "matched" | "excluded" | "transfer";

export interface BankTransaction {
  id: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  description: string;
  accountName: string;
  /** Negative = money out, positive = money in. */
  amount: number;
  status: BankTxnStatus;
  source: "csv" | "plaid";
  matchedInvoiceId?: string;
  /** Label of the other account when the line is a transfer between my own accounts. */
  transferAccount?: string;
  /** Local GL account id chosen in "Categorise". */
  categoryId?: string;
  payee?: string;
}

export interface BankAccount {
  id: string;
  institutionName: string;
  name: string;
  mask?: string;
  subtype?: string;
  lastSyncedAt: string | null;
  status: "connected" | "needs_relogin";
  /** GL account the bank account posts to in the accounting software. */
  mappedGlAccountId?: string;
}

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY";
export type OutflowMode = "negative" | "debit" | "positive";

export interface ColumnMapping {
  /** Column indexes; -1 = not mapped. */
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
}

export interface ParsedRow {
  /** 1-based line number in the file (header = line 1). */
  line: number;
  date: string;
  description: string;
  amount: number;
}

export interface SkippedRow {
  line: number;
  reason: string;
}

export interface InvoiceCandidate {
  id: string;
  vendor: string;
  number: string;
  date: string;
  total: number | null;
}
