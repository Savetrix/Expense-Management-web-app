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
import type { AutoClassification, RuleMatch } from "@/lib/suggestions/match";

import type { Db } from "./db";

export type { RuleMatch } from "@/lib/suggestions/match";

export type ItemStatus = "active" | "login_required" | "pending_expiration" | "pending_disconnect" | "revoked" | "error";
/**
 * review   — waiting for the user.
 * ready    — the user pressed Post: coding confirmed, waiting to go to
 *            QuickBooks/Xero (posting itself is not switched on yet).
 * matched / excluded / transfer — decided another way.
 */
export type TxnStatus = "review" | "ready" | "matched" | "excluded" | "transfer";

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
  postingStatus: "processing" | "posted" | "failed" | null;
  posting: PostingRecord | null;
  /**
   * Entries already in QuickBooks/Xero that could be this line (foundInLedger.ts),
   * when more than one fits and a person has to pick. Absent on older lines.
   */
  ledgerCandidates?: FoundEntry[] | null;
  /** Entry keys a person said are NOT this line ("Not this"); never linked again. */
  ledgerRejected?: string[];

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
  /** Where the change came from: the web app, Plaid, Scantrix's Autopilot, or the server itself. */
  source: "web" | "plaid" | "autopilot" | "system";
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

/**
 * Which bank or credit-card account in QuickBooks/Xero an account NAME posts
 * to: a CSV-imported account, or the other side of a transfer typed by hand.
 * (A Plaid account keeps its own mapping on AccountDoc.)
 * _id = `${qbConnectionId}:${accountLabel lower-cased}`.
 */
export interface LedgerMappingDoc {
  _id: string;
  qbConnectionId: string;
  accountLabel: string;
  ledgerAccountId: string;
  ledgerAccountName: string;
  updatedBy: string;
  updatedAt: Date;
}

/** What was sent to QuickBooks/Xero for one line (TxnDoc.posting). */
export interface PostingRecord {
  provider: string;
  kind: "expense" | "deposit" | "billPayment" | "transfer";
  /** Sent as QuickBooks' requestid / Xero's Idempotency-Key; changes only after a definite failure. */
  idempotencyKey: string;
  attempt: number;
  externalId: string | null;
  url: string | null;
  /** The line whose post created this entry, when this line is the other side of a transfer. */
  viaTransactionId: string | null;
  error: string | null;
  /** The last failure gave no clear answer: the entry may exist, so the key is kept. */
  uncertain: boolean;
  startedAt: Date;
  postedAt: Date | null;
  postedBy: string;
  /**
   * Set when Scantrix didn't make this entry: someone entered the line straight
   * into QuickBooks/Xero and Scantrix found it there (foundInLedger.ts).
   */
  found?: (FoundEntry & { auto: boolean }) | null;
}

/** An entry already in QuickBooks/Xero, as kept on a bank line. */
export interface FoundEntry {
  /** LedgerEntry.key: `${entity}:${id}` (+ ":from"/":to" for a transfer side). */
  key: string;
  entity: string;
  id: string;
  label: string;
  name: string | null;
  date: string;
  amountCents: number;
  url: string | null;
}

/**
 * A company rule (Smart Suggestions, step 1): "Always code Esso to Vehicle
 * expense". It beats the company's history, so a line it matches is filled in
 * even for a payee seen for the first time. A person still presses Post.
 *   payee       — `value` is a payee key (suggest.ts payeeKey).
 *   description — `value` is words that must appear in the bank description.
 *   category    — `value` is Plaid's category, e.g. GAS_STATIONS.
 * Accounts are kept by their id in QuickBooks/Xero, never by name.
 */
export interface RuleDoc {
  _id: string;
  qbConnectionId: string;
  match: RuleMatch;
  value: string;
  /** What the person saw or typed ("Esso"), for the sentence on screen. */
  label: string;
  glAccountId: string;
  taxCodeId: string | null;
  /** Set when the GL account is no longer active in QuickBooks/Xero: the rule is skipped until it is fixed. */
  brokenAt?: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedBy: string;
  updatedAt: Date;
}

/**
 * A company's Smart Suggestions settings. _id = qbConnectionId.
 * Auto-classification: off (no suggestions), suggest (shown, never filled in)
 * or fill (only sure suggestions are filled in; the default).
 */
/**
 * Smart Suggestions, step 2: a payee a person linked to a vendor by picking
 * that vendor on one of its lines. _id = `${qbConnectionId}:${payeeKey}`.
 */
export interface PayeeLinkDoc {
  _id: string;
  qbConnectionId: string;
  payeeKey: string;
  /** The vendor's id in Scantrix (the same id bank lines store). */
  vendorId: string;
  /** The payee as the person wrote it on that line. */
  payee: string | null;
  linkedBy: string;
  linkedAt: Date;
}

export interface SuggestionSettingsDoc {
  _id: string;
  autoClassification: AutoClassification;
  /** "Learn from QuickBooks or Xero history": on unless someone turned it off. */
  learnFromHistory?: boolean;
  /** The last read of the company's books (history.ts). */
  historyImport?: HistoryImportStatus | null;
  updatedBy: string;
  updatedAt: Date;
}

export interface HistoryImportStatus {
  at: Date;
  provider: string;
  /** "done", or why nothing was read: "real_company" (not switched on for real companies yet), "provider_terms", "error". */
  outcome: "done" | "real_company" | "provider_terms" | "error";
  from: string | null;
  to: string | null;
  /** Coded lines saved, and the entries they came from. */
  lines: number;
  entries: number;
  /** Entries left out because Scantrix posted them itself. */
  skippedScantrix: number;
  error?: string | null;
}

/**
 * One coded line from the company's own books in QuickBooks/Xero (Smart
 * Suggestions, history): counted like a past decision a person made. Removed
 * when the setting is switched off. _id = `${qbConnectionId}:${entity}:${entryId}:${line}`.
 */
export interface HistoryDoc {
  _id: string;
  qbConnectionId: string;
  source: "quickbooks" | "xero";
  entity: "Bill" | "Purchase" | "Deposit" | "BillPayment";
  entryId: string;
  line: number;
  date: string;
  amountCents: number;
  /** The vendor (or customer) in QuickBooks/Xero, and the Scantrix vendor it is, when known. */
  vendorExternalId: string | null;
  vendorId: string | null;
  vendorName: string | null;
  /** The vendor's name, cleaned for matching bank payees (history.ts nameKey). */
  nameKey: string | null;
  glAccountId: string | null;
  taxCodeId: string | null;
  bankAccountId: string | null;
  credit: boolean;
  dominant: boolean;
  importedAt: Date;
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
    db.ledgerMappings.createIndex({ qbConnectionId: 1 }),
    db.rules.createIndex({ qbConnectionId: 1, updatedAt: -1 }),
    db.payeeLinks.createIndex({ qbConnectionId: 1, payeeKey: 1 }),
    db.history.createIndex({ qbConnectionId: 1, nameKey: 1 }),
    db.history.createIndex({ qbConnectionId: 1, vendorId: 1 }),
    db.txns.createIndex({ qbConnectionId: 1, vendorId: 1, decidedAt: -1 }),
  ]);
}
