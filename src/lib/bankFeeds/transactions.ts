// SERVER-ONLY. Listing bank lines and recording what the user decided about
// each one, so every choice survives a refresh and is shared by the team.
//
// Decisions are optimistic-concurrency checked: the browser sends the line's
// `version`, and a stale write (another tab or teammate changed the line in the
// meantime) gets 409 with the current line instead of silently overwriting it.
// The check is part of the update's filter, so it is atomic.
import { randomUUID } from "node:crypto";

import type { Filter } from "mongodb";

import type { Db } from "./db";
import type { TxnDoc, TxnStatus } from "./schema";
import { logEvent } from "./store";

export type { TxnStatus } from "./schema";
const STATUSES: TxnStatus[] = ["review", "ready", "matched", "excluded", "transfer"];

/** The browser's shape: components/v2/bankTransactions/types.ts BankTransaction, plus server fields. */
export interface BankTransactionView {
  id: string;
  date: string;
  description: string;
  accountName: string;
  accountId: string | null;
  amount: number;
  currency: string | null;
  status: TxnStatus;
  source: "csv" | "plaid";
  matchedInvoiceId?: string;
  transferAccount?: string;
  transferAccountId?: string;
  categoryId?: string;
  taxCodeId?: string;
  vendorId?: string;
  payee?: string;
  merchantName?: string;
  bankCategory?: string;
  suggestion?: unknown;
  postingStatus?: string;
  /** What the screen needs about the entry in QuickBooks/Xero (no keys). */
  posting?: { kind: string; externalId: string | null; url: string | null; error: string | null; postedAt: string | null; viaTransactionId: string | null };
  decidedAt?: string;
  version: number;
}

export function toView(r: TxnDoc): BankTransactionView {
  return {
    id: r._id,
    date: r.date,
    description: r.description,
    accountName: r.accountLabel,
    accountId: r.accountId,
    amount: r.amountCents / 100,
    currency: r.currency,
    status: r.status,
    source: r.source,
    matchedInvoiceId: r.matchedInvoiceId ?? undefined,
    transferAccount: r.transferLabel ?? undefined,
    transferAccountId: r.transferAccountId ?? undefined,
    categoryId: r.glAccountId ?? undefined,
    taxCodeId: r.taxCodeId ?? undefined,
    vendorId: r.vendorId ?? undefined,
    payee: r.payee ?? undefined,
    merchantName: r.merchantName ?? r.counterpartyName ?? undefined,
    bankCategory: r.categoryDetailed ?? r.categoryPrimary ?? undefined,
    suggestion: r.suggestion ?? undefined,
    postingStatus: r.postingStatus ?? undefined,
    posting: r.posting
      ? {
          kind: r.posting.kind,
          externalId: r.posting.externalId,
          url: r.posting.url,
          error: r.posting.error,
          postedAt: r.posting.postedAt ? new Date(r.posting.postedAt).toISOString() : null,
          viaTransactionId: r.posting.viaTransactionId,
        }
      : undefined,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : undefined,
    version: r.version,
  };
}

export interface ListFilter {
  status?: TxnStatus;
  accountId?: string;
  from?: string;
  to?: string;
  invoiceId?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Plenty for a screen; the list filters and searches on the client. */
const LIST_LIMIT = 5000;

export async function listTransactions(db: Db, qbConnectionId: string, f: ListFilter = {}): Promise<BankTransactionView[]> {
  const q: Filter<TxnDoc> = { qbConnectionId, removedAt: null };
  if (f.status && STATUSES.includes(f.status)) q.status = f.status;
  if (typeof f.accountId === "string" && f.accountId) q.accountId = f.accountId;
  const date: Record<string, string> = {};
  if (f.from && ISO_DATE.test(f.from)) date.$gte = f.from;
  if (f.to && ISO_DATE.test(f.to)) date.$lte = f.to;
  if (Object.keys(date).length) q.date = date;
  if (typeof f.invoiceId === "string" && f.invoiceId) q.matchedInvoiceId = f.invoiceId;
  const rows = await db.txns.find(q).sort({ date: -1, createdAt: -1 }).limit(LIST_LIMIT).toArray();
  return rows.map(toView);
}

export async function getTransaction(db: Db, qbConnectionId: string, id: string): Promise<TxnDoc | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return db.txns.findOne({ _id: id, qbConnectionId, removedAt: null });
}

/** What a user may change on a line. `undefined` = leave as is, `null` = clear. */
export interface DecisionPatch {
  status?: TxnStatus;
  matchedInvoiceId?: string | null;
  transferLabel?: string | null;
  transferAccountId?: string | null;
  glAccountId?: string | null;
  taxCodeId?: string | null;
  vendorId?: string | null;
  payee?: string | null;
}

const str = (v: unknown, max = 200): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t === "" ? null : t;
};

/** Reads a patch from a request body; unknown keys are ignored. Returns an error string when invalid. */
export function readPatch(body: Record<string, unknown>): DecisionPatch | string {
  const patch: DecisionPatch = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as TxnStatus)) return "Unknown status.";
    patch.status = body.status as TxnStatus;
  }
  patch.matchedInvoiceId = str(body.matchedInvoiceId, 64);
  patch.transferLabel = str(body.transferAccount);
  patch.transferAccountId = str(body.transferAccountId, 64);
  if (patch.transferAccountId && !/^[0-9a-f-]{36}$/i.test(patch.transferAccountId)) return "Unknown account.";
  patch.glAccountId = str(body.categoryId, 64);
  patch.taxCodeId = str(body.taxCodeId, 64);
  patch.vendorId = str(body.vendorId, 64);
  patch.payee = str(body.payee);
  return patch;
}

/**
 * The status rules, so a line can never end up half-decided:
 *   ready    → (Post) needs a GL account; clears any bill or transfer.
 *   matched  → needs a bill; clears any transfer.
 *   transfer → needs the other account; clears any bill.
 *   excluded → clears bill and transfer (coding is kept, for Restore).
 *   review   → clears bill and transfer.
 */
export function normalise(current: TxnDoc, patch: DecisionPatch): { next: DecisionPatch; error?: string } {
  const status = patch.status ?? current.status;
  const next: DecisionPatch = { ...patch };
  if (status === "ready") {
    const gl = patch.glAccountId !== undefined ? patch.glAccountId : current.glAccountId;
    if (!gl) return { next, error: "Pick a GL account before posting." };
    next.matchedInvoiceId = null;
    next.transferLabel = null;
    next.transferAccountId = null;
  } else if (status === "matched") {
    const invoice = patch.matchedInvoiceId !== undefined ? patch.matchedInvoiceId : current.matchedInvoiceId;
    if (!invoice) return { next, error: "Pick the bill this line paid." };
    next.transferLabel = null;
    next.transferAccountId = null;
  } else if (status === "transfer") {
    const label = patch.transferLabel !== undefined ? patch.transferLabel : current.transferLabel;
    if (!label) return { next, error: "Pick the other account." };
    next.matchedInvoiceId = null;
  } else if (patch.status) {
    next.matchedInvoiceId = null;
    next.transferLabel = null;
    next.transferAccountId = null;
  }
  return { next };
}

export type DecideResult = { ok: true; txn: BankTransactionView } | { ok: false; status: 404 | 409 | 400; error: string; current?: BankTransactionView };

const STALE = "Someone changed this line a moment ago. It has been refreshed.";

export async function decide(
  db: Db,
  args: { qbConnectionId: string; id: string; userId: string; patch: DecisionPatch; expectedVersion?: number; action?: string },
): Promise<DecideResult> {
  const current = await getTransaction(db, args.qbConnectionId, args.id);
  if (!current) return { ok: false, status: 404, error: "That transaction isn't here any more." };
  if (args.expectedVersion !== undefined && args.expectedVersion !== current.version) {
    return { ok: false, status: 409, error: STALE, current: toView(current) };
  }
  if (current.postingStatus === "posted" || current.postingStatus === "processing") {
    return { ok: false, status: 409, error: "This line is already in the accounting software. Undo it there first.", current: toView(current) };
  }
  const { next, error } = normalise(current, args.patch);
  if (error) return { ok: false, status: 400, error };
  if (next.transferAccountId) {
    const exists = await db.accounts.countDocuments({ _id: next.transferAccountId, qbConnectionId: args.qbConnectionId });
    if (exists === 0) return { ok: false, status: 400, error: "Unknown account." };
  }
  if (next.status === "matched" && next.matchedInvoiceId) {
    // One bank line per bill: a bill already matched to another line is not offered twice.
    const taken = await db.txns.countDocuments({
      qbConnectionId: args.qbConnectionId,
      matchedInvoiceId: next.matchedInvoiceId,
      _id: { $ne: args.id },
      status: "matched",
      removedAt: null,
    });
    if (taken > 0) return { ok: false, status: 409, error: "That bill is already matched to another bank line." };
  }

  const set: Partial<TxnDoc> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof DecisionPatch)[]) {
    const value = next[key];
    if (value === undefined) continue;
    (set as Record<string, unknown>)[key] = value;
    before[key] = (current as unknown as Record<string, unknown>)[key] ?? null;
    after[key] = value;
  }
  if (Object.keys(set).length === 0) return { ok: true, txn: toView(current) };
  const updated = await db.txns.findOneAndUpdate(
    { _id: args.id, qbConnectionId: args.qbConnectionId, version: current.version },
    { $set: { ...set, decidedBy: args.userId, decidedAt: new Date(), updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!updated) {
    const fresh = await getTransaction(db, args.qbConnectionId, args.id);
    return { ok: false, status: 409, error: STALE, current: fresh ? toView(fresh) : undefined };
  }
  await logEvent(db, { qbConnectionId: args.qbConnectionId, transactionId: args.id, actor: args.userId, action: args.action ?? "bank.decision", detail: { before, after } });
  return { ok: true, txn: toView(updated) };
}

// ---------------------------------------------------------------- CSV import

export interface CsvRowIn {
  date: string;
  description: string;
  amount: number;
}

/** Same key as the browser's csv.ts dedupeKey: date | amount | description, case-folded, spaces collapsed. */
export function csvKey(r: CsvRowIn): string {
  return `${r.date}|${r.amount.toFixed(2)}|${r.description.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/** A new line's starting state: undecided, unposted. */
export function blankDecision(now: Date): Pick<
  TxnDoc,
  | "status" | "matchedInvoiceId" | "transferAccountId" | "transferLabel" | "glAccountId" | "taxCodeId" | "vendorId" | "payee"
  | "decidedBy" | "decidedAt" | "payeeKey" | "suggestion" | "postingStatus" | "posting" | "version" | "createdAt" | "updatedAt" | "removedAt"
> {
  return {
    status: "review",
    matchedInvoiceId: null,
    transferAccountId: null,
    transferLabel: null,
    glAccountId: null,
    taxCodeId: null,
    vendorId: null,
    payee: null,
    decidedBy: null,
    decidedAt: null,
    payeeKey: null,
    suggestion: null,
    postingStatus: null,
    posting: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    removedAt: null,
  };
}

/**
 * Saves CSV rows. A duplicate is the same account, date, amount and
 * description (the PRD's rule), so re-importing a file adds nothing, while the
 * same line in another account is kept. Two identical lines in one file (two
 * coffees, same day, same price) are both kept: each gets an occurrence number.
 */
export async function importCsv(db: Db, args: { qbConnectionId: string; userId: string; accountLabel: string; rows: CsvRowIn[] }): Promise<{ added: number; duplicates: number }> {
  if (args.rows.length === 0) return { added: 0, duplicates: 0 };
  const seen = new Map<string, number>();
  const now = new Date();
  const label = args.accountLabel.trim().slice(0, 200) || "Imported file";
  const docs: TxnDoc[] = args.rows.map((r) => {
    const base = `${label.toLowerCase()}|${csvKey(r)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      _id: randomUUID(),
      qbConnectionId: args.qbConnectionId,
      accountId: null,
      accountLabel: label,
      source: "csv",
      csvDedupeKey: `${base}#${n}`,
      date: r.date,
      authorizedDate: null,
      description: r.description.slice(0, 500),
      merchantName: null,
      merchantEntityId: null,
      counterpartyName: null,
      counterpartyType: null,
      logoUrl: null,
      website: null,
      amountCents: Math.round(r.amount * 100),
      currency: null,
      categoryPrimary: null,
      categoryDetailed: null,
      categoryConfidence: null,
      paymentChannel: null,
      checkNumber: null,
      ...blankDecision(now),
    };
  });
  // Upsert on the dedupe key: an existing line is left exactly as it is.
  const r = await db.txns.bulkWrite(
    docs.map((d) => ({ updateOne: { filter: { qbConnectionId: d.qbConnectionId, csvDedupeKey: d.csvDedupeKey }, update: { $setOnInsert: d }, upsert: true } })),
    { ordered: false },
  );
  const added = r.upsertedCount;
  await logEvent(db, { qbConnectionId: args.qbConnectionId, actor: args.userId, action: "bank.csv_imported", detail: { accountLabel: label, rows: docs.length, added } });
  return { added, duplicates: docs.length - added };
}

/** For period close ("Clear the bank"): lines dated on or before `to` that are not yet in the books. */
export async function unsortedCounts(db: Db, qbConnectionId: string, to: string | null): Promise<{ toReview: number; readyToPost: number }> {
  const date = to && ISO_DATE.test(to) ? { date: { $lte: to } } : {};
  const [toReview, readyToPost] = await Promise.all([
    db.txns.countDocuments({ qbConnectionId, removedAt: null, status: "review", ...date }),
    // Decided but not yet in QuickBooks/Xero: the "Clear the bank" step waits for these too.
    db.txns.countDocuments({ qbConnectionId, removedAt: null, status: { $in: ["ready", "matched", "transfer"] }, postingStatus: { $ne: "posted" }, ...date }),
  ]);
  return { toReview, readyToPost };
}
