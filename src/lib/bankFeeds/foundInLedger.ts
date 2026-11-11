// SERVER-ONLY. "Already in QuickBooks/Xero": a bank line someone entered
// straight into the accounting software (its own bank feed, or by hand) leaves
// To review, instead of waiting there to be entered a second time.
//
// QuickBooks and Xero don't let apps read their own bank-feed lists, but what
// those lists create are ordinary entries the API can read. So:
//
//   line in To review → entries on the same bank account (Connected accounts),
//   same amount to the cent, dated within 3 days, not made by Scantrix:
//     exactly one fits, and it fits no other line → linked by itself: the line
//       moves to Matched as "Entered in QuickBooks"; nothing is posted
//     more than one fits, or one entry fits two lines → the line stays in To
//       review with the candidates, and a person picks
//   "Not this" puts a linked line back and never links that entry to it again.
import type { Db } from "./db";
import type { LedgerAdapter, LedgerContext, LedgerEntry } from "./ledger/types";
import { ledgerAccountFor } from "./ledgerMappings";
import type { FoundEntry, PostingRecord, TxnDoc } from "./schema";
import { logEvent } from "./store";
import { getTransaction, toView, type BankTransactionView } from "./transactions";

export const FOUND_WINDOW_DAYS = 3;
const MAX_CANDIDATES = 5;
const MAX_LINES = 2000;
/** Lines older than this before the newest one aren't searched, so one range covers them all. */
const MAX_RANGE_DAYS = 400;
const DAY_MS = 86_400_000;

const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS;
const daysApart = (a: string, b: string) => Math.abs(dayNumber(a) - dayNumber(b));
const shiftDays = (d: string, n: number) => new Date((dayNumber(d) + n) * DAY_MS).toISOString().slice(0, 10);

export interface LineToCheck {
  id: string;
  /** The bank or card account in QuickBooks/Xero this line's account posts to. */
  ledgerAccountId: string;
  date: string;
  amountCents: number;
  /** Entry keys a person said are not this line. */
  rejected: readonly string[];
}

export interface FoundMatches {
  /** Line id → the one entry that is surely it. */
  links: Map<string, LedgerEntry>;
  /** Line id → the entries that could be it, nearest date first. */
  possible: Map<string, LedgerEntry[]>;
}

/**
 * Pure. `taken`: entries already linked to a line — the ids of entries Scantrix
 * posted, and the keys of entries found before.
 */
export function matchEntries(lines: LineToCheck[], entries: LedgerEntry[], taken: ReadonlySet<string>, windowDays = FOUND_WINDOW_DAYS): FoundMatches {
  const fits = new Map<string, LedgerEntry[]>();
  const linesPerEntry = new Map<string, number>();
  for (const line of lines) {
    const candidates = entries
      .filter(
        (e) =>
          !taken.has(e.id) &&
          !taken.has(e.key) &&
          e.accountId === line.ledgerAccountId &&
          e.amountCents === line.amountCents &&
          daysApart(e.date, line.date) <= windowDays &&
          !line.rejected.includes(e.key),
      )
      .sort((a, b) => daysApart(a.date, line.date) - daysApart(b.date, line.date) || a.key.localeCompare(b.key));
    if (candidates.length === 0) continue;
    fits.set(line.id, candidates);
    for (const e of candidates) linesPerEntry.set(e.key, (linesPerEntry.get(e.key) ?? 0) + 1);
  }
  const links = new Map<string, LedgerEntry>();
  const possible = new Map<string, LedgerEntry[]>();
  for (const [id, candidates] of fits) {
    if (candidates.length === 1 && linesPerEntry.get(candidates[0].key) === 1) links.set(id, candidates[0]);
    else possible.set(id, candidates.slice(0, MAX_CANDIDATES));
  }
  return { links, possible };
}

const toFound = (e: LedgerEntry): FoundEntry => ({ key: e.key, entity: e.entity, id: e.id, label: e.label, name: e.name, date: e.date, amountCents: e.amountCents, url: e.url });

/** Entries already linked to a line of this company: Scantrix's own (by id) and found ones (by key). */
async function takenEntries(db: Db, qbConnectionId: string): Promise<Set<string>> {
  const rows = await db.txns.find({ qbConnectionId, "posting.externalId": { $ne: null } }, { projection: { posting: 1 } }).toArray();
  const taken = new Set<string>();
  for (const r of rows) {
    if (r.posting?.found) taken.add(r.posting.found.key);
    else if (r.posting?.externalId) taken.add(r.posting.externalId);
  }
  return taken;
}

/** The line becomes "Entered in QuickBooks/Xero": Matched, with the entry as its posting. Nothing is sent. */
async function linkLine(db: Db, doc: TxnDoc, entry: FoundEntry, opts: { provider: string; userId: string; auto: boolean }): Promise<TxnDoc | null> {
  const now = new Date();
  const kind: PostingRecord["kind"] = /transfer/i.test(entry.entity) ? "transfer" : entry.label === "Bill payment" ? "billPayment" : entry.amountCents < 0 ? "expense" : "deposit";
  const posting: PostingRecord = {
    provider: opts.provider,
    kind,
    idempotencyKey: "",
    attempt: 0,
    externalId: entry.id,
    url: entry.url,
    viaTransactionId: null,
    error: null,
    uncertain: false,
    startedAt: now,
    postedAt: now,
    postedBy: opts.userId,
    found: { ...entry, auto: opts.auto },
  };
  const updated = await db.txns.findOneAndUpdate(
    { _id: doc._id, qbConnectionId: doc.qbConnectionId, version: doc.version, status: "review", postingStatus: { $in: [null, "failed"] } },
    {
      $set: {
        status: "matched",
        matchedInvoiceId: null,
        transferLabel: null,
        transferAccountId: null,
        postingStatus: "posted",
        posting,
        ledgerCandidates: null,
        decidedBy: opts.auto ? "system" : opts.userId,
        decidedAt: now,
        updatedAt: now,
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  );
  if (updated) {
    await logEvent(db, {
      qbConnectionId: doc.qbConnectionId,
      actor: opts.auto ? "system" : opts.userId,
      action: "bank.found_in_ledger",
      transactionId: doc._id,
      detail: { entry: entry.key, label: entry.label, auto: opts.auto, checkedBy: opts.userId, provider: opts.provider },
    });
  }
  return updated;
}

export interface FindOutcome {
  /** Lines in To review that could be checked (their bank account is mapped). */
  checked: number;
  linked: number;
  possible: number;
}

/** Checks this company's lines in To review against the entries already in QuickBooks/Xero. */
export async function findInLedger(
  db: Db,
  ledger: { ctx: LedgerContext; adapter: LedgerAdapter },
  args: { qbConnectionId: string; userId: string },
): Promise<FindOutcome> {
  const { qbConnectionId } = args;
  const rows = await db.txns
    .find({ qbConnectionId, removedAt: null, status: "review", postingStatus: { $in: [null, "failed"] } })
    .sort({ date: -1 })
    .limit(MAX_LINES)
    .toArray();

  // Only lines whose bank account is mapped can be checked: the entry must be on that account.
  const mapped = new Map<string, string | null>();
  const lines: (LineToCheck & { doc: TxnDoc })[] = [];
  for (const r of rows) {
    const k = `${r.accountId ?? ""}|${r.accountLabel}`;
    if (!mapped.has(k)) mapped.set(k, (await ledgerAccountFor(db, qbConnectionId, { accountId: r.accountId, label: r.accountLabel }))?.id ?? null);
    const account = mapped.get(k);
    if (!account || !r.amountCents) continue;
    lines.push({ id: r._id, ledgerAccountId: account, date: r.date, amountCents: r.amountCents, rejected: r.ledgerRejected ?? [], doc: r });
  }
  const newest = lines.reduce((max, l) => (l.date > max ? l.date : max), "");
  const inRange = newest ? lines.filter((l) => l.date >= shiftDays(newest, -MAX_RANGE_DAYS)) : [];

  let matches: FoundMatches = { links: new Map(), possible: new Map() };
  if (inRange.length > 0) {
    const oldest = inRange.reduce((min, l) => (l.date < min ? l.date : min), newest);
    const entries = await ledger.adapter.entriesBetween(ledger.ctx, shiftDays(oldest, -FOUND_WINDOW_DAYS), shiftDays(newest, FOUND_WINDOW_DAYS));
    matches = matchEntries(inRange, entries, await takenEntries(db, qbConnectionId));
  }

  let linked = 0;
  for (const line of inRange) {
    const entry = matches.links.get(line.id);
    if (entry && (await linkLine(db, line.doc, toFound(entry), { provider: ledger.ctx.provider, userId: args.userId, auto: true }))) linked++;
  }

  // Candidates are a hint for a person, not a decision: no version change, so
  // nobody's edit in progress is refused because of them.
  let possible = 0;
  for (const r of rows) {
    if (matches.links.has(r._id)) continue;
    const candidates = matches.possible.get(r._id)?.map(toFound) ?? null;
    if (candidates) possible++;
    const before = JSON.stringify(r.ledgerCandidates ?? null);
    if (JSON.stringify(candidates) === before) continue;
    await db.txns.updateOne({ _id: r._id, qbConnectionId, status: "review" }, { $set: { ledgerCandidates: candidates } });
  }
  return { checked: lines.length, linked, possible };
}

export type FoundResult = { ok: true; txn: BankTransactionView } | { ok: false; status: 400 | 404 | 409; error: string };

/** A person picks which of the found entries is this line. */
export async function linkFoundEntry(db: Db, args: { qbConnectionId: string; id: string; key: string; userId: string; provider: string }): Promise<FoundResult> {
  const doc = await getTransaction(db, args.qbConnectionId, args.id);
  if (!doc) return { ok: false, status: 404, error: "That transaction isn't here any more." };
  if (doc.status !== "review" || doc.postingStatus === "posted" || doc.postingStatus === "processing") {
    return { ok: false, status: 409, error: "This line was already decided. Refresh the page." };
  }
  const entry = (doc.ledgerCandidates ?? []).find((c) => c.key === args.key);
  if (!entry) return { ok: false, status: 400, error: "Pick one of the entries Scantrix found for this line." };
  const taken = await takenEntries(db, args.qbConnectionId);
  if (taken.has(entry.key) || taken.has(entry.id)) return { ok: false, status: 409, error: "That entry is already linked to another bank line." };
  const updated = await linkLine(db, doc, entry, { provider: args.provider, userId: args.userId, auto: false });
  if (!updated) return { ok: false, status: 409, error: "Someone changed this line a moment ago. Refresh and try again." };
  return { ok: true, txn: toView(updated) };
}

/** "Not this": a found line goes back to To review, and that entry is never linked to it again. */
export async function unlinkFoundEntry(db: Db, args: { qbConnectionId: string; id: string; userId: string }): Promise<FoundResult> {
  const doc = await getTransaction(db, args.qbConnectionId, args.id);
  if (!doc) return { ok: false, status: 404, error: "That transaction isn't here any more." };
  const found = doc.posting?.found;
  if (!found) return { ok: false, status: 400, error: "Only a line Scantrix found already entered in the accounting software can be put back here." };
  const now = new Date();
  const updated = await db.txns.findOneAndUpdate(
    { _id: doc._id, qbConnectionId: args.qbConnectionId, version: doc.version, "posting.found.key": found.key },
    {
      $set: { status: "review", postingStatus: null, posting: null, ledgerCandidates: null, decidedBy: args.userId, decidedAt: now, updatedAt: now },
      $addToSet: { ledgerRejected: found.key },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  );
  if (!updated) return { ok: false, status: 409, error: "Someone changed this line a moment ago. Refresh and try again." };
  await logEvent(db, { qbConnectionId: args.qbConnectionId, actor: args.userId, action: "bank.found_unlinked", transactionId: doc._id, detail: { entry: found.key, label: found.label } });
  return { ok: true, txn: toView(updated) };
}
