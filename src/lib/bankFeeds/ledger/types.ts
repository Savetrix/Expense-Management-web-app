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

export interface LedgerAdapter {
  listAccounts(ctx: LedgerContext): Promise<LedgerAccount[]>;
  post(ctx: LedgerContext, posting: Posting, idempotencyKey: string): Promise<PostedEntry>;
}
