// SERVER-ONLY. Smart Suggestions, history: Scantrix learns from the last 12
// months of the company's own coding in QuickBooks, so suggestions work from
// day one (Saurabh, 11 Nov call). No AI and no rule screen: the coded lines are
// saved in the company memory (suggestion_history), marked as coming from the
// books, and step 2 counts them like decisions a person made in Scantrix.
//
//   read  — bills, expenses and card charges, deposits, bill payments dated in
//           the last 12 months (ledger adapter historyBetween)
//   skip  — entries Scantrix posted itself (bank lines it sent, bills it
//           posted), so nothing is counted twice
//   match — a bank payee to a vendor in the books by the cleaned-up name
//           ("PETRO-CANADA 1234 TORONTO" ↔ "Petro-Canada"), or through the
//           vendor a person linked to that payee. What can't be matched safely
//           is left for step 3.
//
// Terms (checked 13 Nov 2026): Xero's developer terms forbid using API data to
// "adapt or enhance" predictive tools, so Xero has no history reader. Intuit's
// new terms (from 12 Dec 2026) forbid using QuickBooks data to develop AI or ML
// models; plain counting for the same company is unclear, so reading real
// companies' books is switched off (SUGGESTIONS_HISTORY_REAL_COMPANIES) and
// only sandbox companies are read until that is confirmed.
import { payeeKey } from "@/lib/suggestions/match";

import type { Db } from "./db";
import type { HistoryLine, LedgerAdapter, LedgerContext } from "./ledger/types";
import type { HistoryDoc, HistoryImportStatus } from "./schema";
import { logEvent } from "./store";

export const HISTORY_DAYS = 365;
/** A company's books are read again when the last read is older than this. */
export const HISTORY_REFRESH_MS = 24 * 3_600_000;
const DAY_MS = 86_400_000;

/** Reading real (not sandbox) companies' books needs this switch: the terms question is still open. */
export const historyAllowedForRealCompanies = () => process.env.SUGGESTIONS_HISTORY_REAL_COMPANIES?.trim() === "true";

// Words that don't say who the vendor is ("Petro-Canada Ltd" is "Petro-Canada").
const LEGAL = new Set(["inc", "incorporated", "ltd", "limited", "llc", "llp", "plc", "corp", "corporation", "co", "company", "the"]);

/** A vendor name cleaned the way bank payees are: "Petro-Canada Ltd." → "petro canada". Null when too short to match safely. */
export function nameKey(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  const words = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !LEGAL.has(w));
  const key = payeeKey(null, words.join(" "));
  return key.replace(/ /g, "").length >= 3 ? key : null;
}

/**
 * True when a bank payee (its payee key) is this vendor (its name key), safely:
 * the same words, the payee starting with the vendor's whole name ("petro canada
 * toronto" ↔ "petro canada"), or the same letters run together ("petrocanada",
 * "mcdonalds" ↔ "mcdonald"). A shared first word alone ("uber eats" ↔ "uber
 * technologies", "amazon" ↔ "amazon web services") is not enough.
 */
export function historyMatches(lineKey: string | null | undefined, key: string | null | undefined): boolean {
  if (!lineKey || !key) return false;
  if (lineKey === key || lineKey.startsWith(`${key} `)) return true;
  const joined = key.replace(/ /g, "");
  let prefix = "";
  for (const w of lineKey.split(" ")) {
    prefix += w;
    if (prefix === joined || prefix === `${joined}s` || `${prefix}s` === joined) return true;
    if (prefix.length > joined.length) break;
  }
  return false;
}

export async function readLearnFromHistory(db: Db, qbConnectionId: string): Promise<boolean> {
  const doc = await db.suggestionSettings.findOne({ _id: qbConnectionId }, { projection: { learnFromHistory: 1 } });
  return doc?.learnFromHistory !== false;
}

export async function readHistoryStatus(db: Db, qbConnectionId: string): Promise<HistoryImportStatus | null> {
  const doc = await db.suggestionSettings.findOne({ _id: qbConnectionId }, { projection: { historyImport: 1 } });
  return doc?.historyImport ?? null;
}

async function saveStatus(db: Db, qbConnectionId: string, status: HistoryImportStatus): Promise<HistoryImportStatus> {
  await db.suggestionSettings.updateOne({ _id: qbConnectionId }, { $set: { historyImport: status } }, { upsert: true });
  return status;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Ids of entries Scantrix posted itself from bank lines (not lines someone entered in the books directly). */
async function scantrixPostedIds(db: Db, qbConnectionId: string): Promise<Set<string>> {
  const rows = await db.txns.find({ qbConnectionId, "posting.externalId": { $ne: null }, "posting.found": null }, { projection: { posting: 1 } }).toArray();
  return new Set(rows.map((r) => r.posting?.externalId).filter((id): id is string => Boolean(id)));
}

export interface ImportArgs {
  qbConnectionId: string;
  userId: string;
  ledger: { ctx: LedgerContext; adapter: LedgerAdapter };
  /** Scantrix vendor id → the vendor's id in QuickBooks/Xero. */
  vendorIds: Map<string, string>;
  /** Bills Scantrix posted (their QuickBooks/Xero ids). */
  scantrixBillIds: Set<string>;
  allowRealCompanies?: boolean;
  now?: number;
}

/**
 * Reads the last 12 months of the company's coding and replaces its history
 * rows with them. Returns what happened, also saved for the settings screen.
 */
export async function importHistory(db: Db, args: ImportArgs): Promise<HistoryImportStatus> {
  const { qbConnectionId } = args;
  const { ctx, adapter } = args.ledger;
  const now = args.now ?? Date.now();
  const base = { at: new Date(now), provider: ctx.provider, from: null, to: null, lines: 0, entries: 0, skippedScantrix: 0 };
  if (!adapter.historyBetween) return saveStatus(db, qbConnectionId, { ...base, outcome: "provider_terms" });
  if (ctx.environment !== "sandbox" && !(args.allowRealCompanies ?? historyAllowedForRealCompanies())) {
    return saveStatus(db, qbConnectionId, { ...base, outcome: "real_company" });
  }

  const from = day(now - HISTORY_DAYS * DAY_MS);
  const to = day(now);
  const lines = await adapter.historyBetween(ctx, from, to);
  const ours = await scantrixPostedIds(db, qbConnectionId);
  const scantrixIdOf = new Map([...args.vendorIds].map(([scantrixId, external]) => [external, scantrixId]));

  const isOurs = (l: HistoryLine) => (l.entity === "Bill" ? args.scantrixBillIds.has(l.id) : ours.has(l.id));
  const skipped = new Set(lines.filter(isOurs).map((l) => `${l.entity}:${l.id}`));
  const importedAt = new Date(now);
  const docs: HistoryDoc[] = lines
    .filter((l) => !isOurs(l))
    .map((l) => ({
      _id: `${qbConnectionId}:${l.entity}:${l.id}:${l.line}`,
      qbConnectionId,
      source: ctx.provider,
      entity: l.entity,
      entryId: l.id,
      line: l.line,
      date: l.date,
      amountCents: l.amountCents,
      vendorExternalId: l.vendorId,
      vendorId: l.vendorId ? (scantrixIdOf.get(l.vendorId) ?? null) : null,
      vendorName: l.vendorName,
      nameKey: nameKey(l.vendorName),
      glAccountId: l.accountId,
      taxCodeId: l.taxCodeId,
      bankAccountId: l.bankAccountId,
      credit: l.credit,
      dominant: l.dominant,
      importedAt,
    }));

  await db.history.deleteMany({ qbConnectionId });
  for (let i = 0; i < docs.length; i += 1000) await db.history.insertMany(docs.slice(i, i + 1000), { ordered: false });
  const entries = new Set(docs.map((d) => `${d.entity}:${d.entryId}`)).size;
  await logEvent(db, { qbConnectionId, actor: args.userId, action: "suggestion.history_imported", detail: { provider: ctx.provider, from, to, lines: docs.length, entries, skippedScantrix: skipped.size } });
  return saveStatus(db, qbConnectionId, { ...base, outcome: "done", from, to, lines: docs.length, entries, skippedScantrix: skipped.size });
}

/** Removes everything read from the books (the setting was switched off). */
export async function removeHistory(db: Db, qbConnectionId: string): Promise<number> {
  const r = await db.history.deleteMany({ qbConnectionId });
  await db.suggestionSettings.updateOne({ _id: qbConnectionId }, { $set: { historyImport: null } });
  return r.deletedCount;
}

export type HistoryPurpose = "bank" | "invoice";

/**
 * The rows that speak for a vendor: one per entry (its biggest line). Bank
 * lines learn from what moved money (expenses, deposits, bill payments);
 * invoices from bills and expenses.
 */
export async function loadHistory(db: Db, qbConnectionId: string, purpose: HistoryPurpose, filter: Record<string, unknown> = {}): Promise<HistoryDoc[]> {
  const entity = purpose === "bank" ? { $in: ["Purchase", "Deposit", "BillPayment"] } : { $in: ["Bill", "Purchase"] };
  return db.history.find({ qbConnectionId, dominant: true, entity, ...filter } as never).toArray();
}

/**
 * For each bank payee, whether a vendor in the books matched it (by name, or
 * through the vendor a person linked to the payee). For the settings screen,
 * and to say how much step 3 has left to bridge.
 */
export async function payeeMatchStats(db: Db, qbConnectionId: string): Promise<{ total: number; matched: number; unmatched: string[] }> {
  const [keys, rows, links] = await Promise.all([
    db.txns
      .find({ qbConnectionId, removedAt: null }, { projection: { payeeKey: 1, merchantName: 1, counterpartyName: 1, description: 1 } })
      .toArray()
      // A line imported a moment ago has no stored key yet: work it out the same way.
      .then((rows) => [...new Set(rows.map((r) => r.payeeKey ?? payeeKey(r.merchantName ?? r.counterpartyName, r.description)).filter(Boolean))]),
    db.history.find({ qbConnectionId }, { projection: { nameKey: 1, vendorId: 1 } }).toArray(),
    db.payeeLinks.find({ qbConnectionId }, { projection: { payeeKey: 1, vendorId: 1 } }).toArray(),
  ]);
  const nameKeys = [...new Set(rows.map((r) => r.nameKey).filter((k): k is string => Boolean(k)))];
  const vendors = new Set(rows.map((r) => r.vendorId).filter(Boolean));
  const linked = new Map(links.map((l) => [l.payeeKey, l.vendorId]));
  const unmatched: string[] = [];
  let matched = 0;
  for (const k of keys) {
    const viaLink = linked.has(k) && vendors.has(linked.get(k) ?? "");
    if (viaLink || nameKeys.some((n) => historyMatches(k, n))) matched++;
    else unmatched.push(k);
  }
  return { total: keys.length, matched, unmatched: unmatched.slice(0, 20) };
}
