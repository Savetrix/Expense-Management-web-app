// SERVER-ONLY. Posting bank lines into the company's accounting software.
//
// The QuickBooks/Xero sign-in lives in the Savetrix backend; this server never
// holds a refresh token. It asks the backend for a working access token per
// batch (token.ts) and talks to QuickBooks or Xero directly with it.

export type LedgerProvider = "quickbooks" | "xero";

export interface LedgerContext {
  provider: LedgerProvider;
  /** QuickBooks realmId, or Xero tenant id. */
  tenantId: string;
  accessToken: string;
  /** QuickBooks only: "sandbox" or "production" API host. */
  environment: string;
  /** Xero only: lets a link open the right organisation. */
  shortCode: string | null;
}

/** One account in the chart of accounts, in the provider's own ids. */
export interface LedgerAccount {
  id: string;
  name: string;
  /** bank / card: money is paid from or into it. income / expense: a line's category. */
  kind: "bank" | "card" | "income" | "expense" | "other";
  type: string;
  currency: string | null;
}

interface PostingBase {
  /** "YYYY-MM-DD". */
  date: string;
  /** Always positive; the kind says which way the money went. */
  amount: number;
  memo: string;
}

/**
 * What one bank line becomes. bankAccount is the mapped bank or credit-card
 * account in QuickBooks/Xero; ids are the provider's own.
 */
export type Posting =
  | (PostingBase & { kind: "expense"; bankAccount: { id: string; isCard: boolean }; vendorId: string | null; glAccountId: string; taxCodeId: string | null; taxRate: number | null })
  | (PostingBase & { kind: "deposit"; bankAccount: { id: string; isCard: boolean }; vendorId: string | null; glAccountId: string; taxCodeId: string | null; taxRate: number | null })
  | (PostingBase & { kind: "billPayment"; bankAccount: { id: string; isCard: boolean }; vendorId: string; billId: string })
  | (PostingBase & { kind: "transfer"; fromAccountId: string; toAccountId: string });

export interface PostedEntry {
  externalId: string;
  url: string | null;
}

/** A raw HTTP request to the provider, built by a pure function (tested on its own). */
export interface LedgerRequest {
  method: "GET" | "POST" | "PUT";
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * definite: the provider refused the request, so nothing was created and a
 *   retry may use a fresh idempotency key (after the user fixes the cause).
 * unknown: no clear answer (network, 5xx, timeout). The entry MAY exist, so a
 *   retry must reuse the same key: the provider then answers with the original.
 */
export class LedgerError extends Error {
  constructor(
    message: string,
    readonly outcome: "definite" | "unknown",
    readonly code: "reconnect" | "scope" | "permission" | "not_configured" | "validation" | "rate_limit" | "unavailable" = "validation",
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

/**
 * An entry already in the books that moved money in or out of a bank or card
 * account: an expense, deposit, transfer side, bill or customer payment. Read
 * to find bank lines someone entered straight into QuickBooks/Xero.
 */
export interface LedgerEntry {
  /** Unique per entry side: `${entity}:${id}`, plus ":from"/":to" for a transfer. */
  key: string;
  /** The provider's own type: "Purchase", "Deposit", "BankTransaction", "Payment"... */
  entity: string;
  /** The provider's id (the same for both sides of a transfer). */
  id: string;
  /** The bank or card account in QuickBooks/Xero the money moved in. */
  accountId: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** Cents; negative = money out of that account. */
  amountCents: number;
  /** For people: "Expense", "Deposit", "Transfer", "Bill payment"... */
  label: string;
  /** Who was paid or who paid, or the memo. */
  name: string | null;
  url: string | null;
}

/**
 * One coded line of an entry already in the books, for learning how the company
 * codes (Smart Suggestions, history): a bill or expense line with its vendor,
 * account and tax code, a deposit line, or a bill payment.
 */
export interface HistoryLine {
  entity: "Bill" | "Purchase" | "Deposit" | "BillPayment";
  /** The provider's id of the entry. */
  id: string;
  /** The line's position in the entry (0 for an entry with one line). */
  line: number;
  /** "YYYY-MM-DD". */
  date: string;
  /** The line's amount in cents, positive. */
  amountCents: number;
  /** Who was paid or who paid: the provider's vendor (or customer) id and name. */
  vendorId: string | null;
  vendorName: string | null;
  /** The GL account the line was coded to (null for a bill payment). */
  accountId: string | null;
  taxCodeId: string | null;
  /** The bank or card account the money moved in (expenses, deposits, bill payments). */
  bankAccountId: string | null;
  /** Money back onto a card (a refund) rather than money out. */
  credit: boolean;
  /** The biggest line of its entry: the one that speaks for the entry when counting. */
  dominant: boolean;
}

export interface LedgerAdapter {
  listAccounts(ctx: LedgerContext): Promise<LedgerAccount[]>;
  /** Entries dated from..to ("YYYY-MM-DD", inclusive) that moved money in a bank or card account. */
  entriesBetween(ctx: LedgerContext, from: string, to: string): Promise<LedgerEntry[]>;
  /** The coded lines of bills, expenses, deposits and bill payments dated from..to. Absent where the provider's terms don't allow it. */
  historyBetween?(ctx: LedgerContext, from: string, to: string): Promise<HistoryLine[]>;
  /** Of these bills (the provider's own ids), the ones with nothing left to pay. Unknown ids are left out. */
  paidBills(ctx: LedgerContext, billIds: string[]): Promise<string[]>;
  post(ctx: LedgerContext, posting: Posting, idempotencyKey: string): Promise<PostedEntry>;
}
