/** "ready" = the user pressed Post; it goes to QuickBooks/Xero once posting is switched on. */
export type BankTxnStatus = "review" | "ready" | "matched" | "excluded" | "transfer";

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
  /** Server row version, for conflict checks. Absent before the first save. */
  version?: number;
  accountId?: string | null;
  transferAccountId?: string;
  taxCodeId?: string;
  vendorId?: string;
  /** Plaid's cleaned-up merchant name, when it knows one. */
  merchantName?: string;
  /** Plaid's spending category, e.g. TRANSPORTATION_TAXIS_AND_RIDE_SHARES. */
  bankCategory?: string;
  currency?: string | null;
  suggestion?: unknown;
  postingStatus?: "processing" | "posted" | "failed";
  /** The entry in QuickBooks/Xero once sent, or the last error. */
  posting?: { kind: string; externalId: string | null; url: string | null; error: string | null; postedAt: string | null; viaTransactionId: string | null };
}

export interface BankAccount {
  id: string;
  /** The bank login (Plaid item) this account belongs to. */
  itemId?: string;
  institutionName: string;
  name: string;
  mask?: string;
  subtype?: string;
  lastSyncedAt: string | null;
  status: "connected" | "needs_relogin" | "syncing";
  /** GL account the bank account posts to in the accounting software. */
  mappedGlAccountId?: string;
  mappedGlAccountName?: string;
  /** Why the bank needs a new sign-in, in plain words. */
  statusDetail?: string | null;
  currentBalance?: number | null;
  currency?: string | null;
  /** Plaid is still pulling the history on the first connect. */
  historyLoading?: boolean;
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
