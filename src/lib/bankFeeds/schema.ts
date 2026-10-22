// Bank-feeds documents and the indexes that enforce their rules.
//
// Everything is scoped by `qbConnectionId`: bank data belongs to a company (one
// connection in QuickBooks or Xero), not to the person who connected it, so
// every team member with access to that company sees the same feed.
//
// Ids are random UUID strings (not ObjectIds), so the browser sees the same
// opaque ids whatever the database.
//
// Money is integer cents, negative = money out. Plaid reports money out as a
// POSITIVE amount, so sync inverts it once, on the way in (plaidMap.ts).
// Dates of bank lines are calendar dates kept as "YYYY-MM-DD" strings, never
// Date objects, so no time zone can move them a day.
import type { Db } from "./db";

export type ItemStatus = "active" | "login_required" | "pending_expiration" | "pending_disconnect" | "revoked" | "error";
export type TxnStatus = "review" | "matched" | "excluded" | "transfer";

/** One bank login (a Plaid "item"); it can hold several accounts. */
export interface ItemDoc {
  _id: string;
  qbConnectionId: string;
  plaidItemId: string;
  plaidEnv: string;
  institutionId: string | null;
  institutionName: string;
  /** AES-256-GCM sealed access token (secretBox), bound to plaidItemId. "removed" once disconnected. */
  sealedAccessToken: string;
  syncCursor: string | null;
  status: ItemStatus;
  errorCode: string | null;
  consentExpiresAt: string | null;
  initialUpdateComplete: boolean;
  historicalUpdateComplete: boolean;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  /** One sync at a time per item; a webhook that lands mid-sync sets syncRequestedAt. */
  syncLeaseUntil: Date | null;
  syncRequestedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  removedAt: Date | null;
}

export interface AccountDoc {
  _id: string;
  itemId: string;
  qbConnectionId: string;
  plaidAccountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currency: string | null;
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  balanceUpdatedAt: Date | null;
  /** The bank or credit-card account in QuickBooks/Xero that this account posts to. */
  ledgerAccountId: string | null;
  ledgerAccountName: string | null;
  createdAt: Date;
  updatedAt: Date;
  removedAt: Date | null;
}

export interface TxnDoc {
  _id: string;
  qbConnectionId: string;
  accountId: string | null;
  /** Shown in the list. A CSV line has only this, no accountId. */
  accountLabel: string;
  source: "plaid" | "csv";
  /** Present only on Plaid lines (unique). */
  plaidTransactionId?: string;
  /** Present only on CSV lines (unique per company). */
  csvDedupeKey?: string;
  date: string;
  authorizedDate: string | null;
  description: string;
  merchantName: string | null;
  merchantEntityId: string | null;
  counterpartyName: string | null;
  counterpartyType: string | null;
  logoUrl: string | null;
  website: string | null;
  amountCents: number;
  currency: string | null;
  categoryPrimary: string | null;
  categoryDetailed: string | null;
  categoryConfidence: string | null;
  paymentChannel: string | null;
  checkNumber: string | null;

  // The user's decision. Plaid updates never touch these fields.
  status: TxnStatus;
  matchedInvoiceId: string | null;
  transferAccountId: string | null;
  transferLabel: string | null;
  glAccountId: string | null;
  taxCodeId: string | null;
  vendorId: string | null;
  payee: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;

  /** Who the line was paid to, normalised (suggest.ts payeeKey). */
  payeeKey: string | null;
  /** What Scantrix suggested, and why (suggest.ts). */
  suggestion: unknown;
  /** Posting to QuickBooks/Xero: null | processing | posted | failed. */
  postingStatus: string | null;
  posting: unknown;

  version: number;
  createdAt: Date;
  updatedAt: Date;
  /** Plaid removed the transaction; kept for the audit trail, hidden from lists. */
  removedAt: Date | null;
}

/** Who did what, for the audit trail and for learning from the user's choices. */
export interface EventDoc {
  qbConnectionId: string;
  transactionId: string | null;
  itemId: string | null;
  /** A user id, or "plaid" / "autopilot" / "system". */
  actor: string;
  action: string;
  detail: unknown;
  at: Date;
}

export interface WebhookLogDoc {
  plaidItemId: string | null;
  webhookType: string | null;
  webhookCode: string | null;
  outcome: string;
  receivedAt: Date;
}

/** What Scantrix noticed on an invoice. _id = `${qbConnectionId}:${invoiceId}`. */
export interface InsightDoc {
  _id: string;
  qbConnectionId: string;
  invoiceId: string;
  periodStart: string | null;
  periodEnd: string | null;
  periodMonths: number | null;
  periodSource: string | null;
  periodEvidence: string | null;
  /** The invoice's updatedAt when the period was read; a later edit re-reads it. */
  readFrom: string | null;
  prepaymentDismissedAt: Date | null;
  prepaymentDismissedBy: string | null;
  updatedAt: Date;
}

const isString = { $type: "string" } as const;

/** Idempotent: safe to run on every cold start. */
export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.items.createIndex({ plaidItemId: 1 }, { unique: true }),
    db.items.createIndex({ qbConnectionId: 1 }),
    db.accounts.createIndex({ plaidAccountId: 1 }, { unique: true }),
    db.accounts.createIndex({ qbConnectionId: 1 }),
    db.accounts.createIndex({ itemId: 1 }),
    db.txns.createIndex({ plaidTransactionId: 1 }, { unique: true, partialFilterExpression: { plaidTransactionId: isString } }),
    db.txns.createIndex({ qbConnectionId: 1, csvDedupeKey: 1 }, { unique: true, partialFilterExpression: { csvDedupeKey: isString } }),
    db.txns.createIndex({ qbConnectionId: 1, status: 1, date: -1 }),
    db.txns.createIndex({ qbConnectionId: 1, matchedInvoiceId: 1 }),
    db.txns.createIndex({ qbConnectionId: 1, payeeKey: 1 }),
    db.txns.createIndex({ accountId: 1 }),
    db.events.createIndex({ qbConnectionId: 1, at: -1 }),
    db.events.createIndex({ transactionId: 1 }),
    db.webhooks.createIndex({ receivedAt: -1 }),
  ]);
}
