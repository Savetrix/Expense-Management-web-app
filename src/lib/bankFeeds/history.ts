// SERVER-ONLY. Smart Suggestions, history: ScanTrix learns from the last 12
// months of the company's own coding in QuickBooks, so suggestions work from
// day one (Saurabh, 11 Nov call). No AI and no rule screen: the coded lines are
// saved in the company memory (suggestion_history), marked as coming from the
// books, and step 2 counts them like decisions a person made in ScanTrix.
//
//   read  — bills, expenses and card charges, deposits, bill payments dated in
//           the last 12 months (ledger adapter historyBetween)
//   skip  — entries ScanTrix posted itself (bank lines it sent, bills it
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
const DAY_MS = 86_400_000;
/** Intuit 8.2(f): what was read is deleted within 30 days of a disconnect. */
export const FORGET_AFTER_DAYS = 30;

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

/**
 * "Learn from QuickBooks history", per company (suggestion_settings): what was
 * set for this company; until then, on for a sandbox (test) company and off
 * for a real one. There is no switch on screen (Saurabh, 20 Nov); set it in the
 * database for one company. A real company is read only when the server also
 * allows real companies (SUGGESTIONS_HISTORY_REAL_COMPANIES): kept off on 20 Nov
 * until Intuit approves the change (terms 7.2, from 12 Dec 2026). The environment is known once ScanTrix has reached
 * QuickBooks for this company (companyLists.ts); unknown counts as real.
 */
export async function readLearnFromHistory(db: Db, qbConnectionId: string): Promise<boolean> {
  const [doc, lists] = await Promise.all([
    db.suggestionSettings.findOne({ _id: qbConnectionId }, { projection: { learnFromHistory: 1 } }),
    db.companyLists.findOne({ _id: qbConnectionId }, { projection: { environment: 1 } }),
  ]);
  const environment = lists?.environment ?? null;
  // A real company's rows are used only while the server allows real companies too.
  if (environment !== "sandbox" && !historyAllowedForRealCompanies()) return false;
  if (typeof doc?.learnFromHistory === "boolean") return doc.learnFromHistory;
  return learnByDefault(environment);
}

/** The setting before anyone chose: on only for a sandbox (test) company. */
export const learnByDefault = (environment: string | null) => environment === "sandbox";

/** True when an Owner or Admin has set the switch for this company. */
export async function learnSettingChosen(db: Db, qbConnectionId: string): Promise<boolean> {
  const doc = await db.suggestionSettings.findOne({ _id: qbConnectionId }, { projection: { learnFromHistory: 1 } });
  return typeof doc?.learnFromHistory === "boolean";
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

/** Ids of entries ScanTrix posted itself from bank lines (not lines someone entered in the books directly). */
async function scantrixPostedIds(db: Db, qbConnectionId: string): Promise<Set<string>> {
  const rows = await db.txns.find({ qbConnectionId, "posting.externalId": { $ne: null }, "posting.found": null }, { projection: { posting: 1 } }).toArray();
  return new Set(rows.map((r) => r.posting?.externalId).filter((id): id is string => Boolean(id)));
}

export interface ImportArgs {
  qbConnectionId: string;
  userId: string;
  ledger: { ctx: LedgerContext; adapter: LedgerAdapter };
  /** ScanTrix vendor id → the vendor's id in QuickBooks/Xero. */
  vendorIds: Map<string, string>;
  /** Bills ScanTrix posted (their QuickBooks/Xero ids). */
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
  // Reaching the books says whether this is a sandbox company (the setting's default).
  await db.companyLists.updateOne({ _id: qbConnectionId }, { $set: { environment: ctx.environment, provider: ctx.provider } }, { upsert: true });
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
      description: l.description,
      importedAt,
    }));

  await db.history.deleteMany({ qbConnectionId });
  for (let i = 0; i < docs.length; i += 1000) await db.history.insertMany(docs.slice(i, i + 1000), { ordered: false });
  const entries = new Set(docs.map((d) => `${d.entity}:${d.entryId}`)).size;
  await logEvent(db, { qbConnectionId, actor: args.userId, action: "suggestion.history_imported", detail: { provider: ctx.provider, from, to, lines: docs.length, entries, skippedScantrix: skipped.size } });
  return saveStatus(db, qbConnectionId, { ...base, outcome: "done", from, to, lines: docs.length, entries, skippedScantrix: skipped.size });
}

/**
 * Removes everything read from the books, and the vectors made from it (the
 * setting was switched off, or the company disconnected). The next switch-on
 * reads again.
 */
export async function removeHistory(db: Db, qbConnectionId: string): Promise<number> {
  const r = await db.history.deleteMany({ qbConnectionId });
  await db.vectors.deleteMany({ qbConnectionId, kind: "history" });
  await db.suggestionSettings.updateOne({ _id: qbConnectionId }, { $set: { historyImport: null } });
  return r.deletedCount;
}

/** True when the books were read and kept: they are read once, not again. */
export const historyRead = (status: HistoryImportStatus | null) => status?.outcome === "done";

/**
 * What opening a page does about the books:
 *   "read_once" — already read: nothing (read again only after off → on);
 *   "off"       — the setting is off (chosen, or a real company's default);
 *   "check"     — nobody chose and ScanTrix doesn't know yet whether this is a
 *                 sandbox company: reach QuickBooks, then decide;
 *   "read"      — read the last 12 months now.
 */
export function readDecision(a: { on: boolean; chosen: boolean; status: HistoryImportStatus | null; environment: string | null }): "read_once" | "off" | "check" | "read" {
  if (a.on && historyRead(a.status)) return "read_once";
  if (a.on) return "read";
  return a.chosen || a.environment ? "off" : "check";
}

const checkedAt = new Map<string, number>();
const CHECK_EVERY_MS = 3_600_000;
let sweptAt = 0;

/**
 * Intuit 8.2(f): a company's history goes when it disconnects. Called with
 * every bank request's caller (throttled per company to once an hour):
 *   - a company the caller sees as "disconnected" loses its history now;
 *   - the company in use is marked live (lastLiveAt);
 *   - once a day, history of companies nobody has used while connected for
 *     FORGET_AFTER_DAYS is removed, which covers a disconnect nobody saw here.
 */
export async function noteConnections(db: Db, connections: readonly { id: string; status: string | null }[], current: string, now = Date.now()): Promise<number> {
  let removed = 0;
  for (const c of connections) {
    if ((checkedAt.get(c.id) ?? 0) > now - CHECK_EVERY_MS) continue;
    checkedAt.set(c.id, now);
    if (c.status === "disconnected") {
      if (await db.history.countDocuments({ qbConnectionId: c.id }, { limit: 1 })) removed += await forget(db, c.id, "disconnected");
    } else if (c.id === current) {
      await db.suggestionSettings.updateOne({ _id: c.id }, { $set: { lastLiveAt: new Date(now) } }, { upsert: true });
    }
  }
  if (sweptAt < now - DAY_MS) {
    sweptAt = now;
    const cutoff = new Date(now - FORGET_AFTER_DAYS * DAY_MS);
    const stale = await db.suggestionSettings.find({ "historyImport.outcome": "done", $or: [{ lastLiveAt: { $lt: cutoff } }, { lastLiveAt: { $exists: false }, "historyImport.at": { $lt: cutoff } }] }, { projection: { _id: 1 } }).toArray();
    for (const s of stale) removed += await forget(db, s._id, "not_used_while_connected");
  }
  return removed;
}

async function forget(db: Db, qbConnectionId: string, reason: string): Promise<number> {
  const n = await removeHistory(db, qbConnectionId);
  await logEvent(db, { qbConnectionId, transactionId: null, actor: "system", action: "suggestion.history_removed", detail: { reason, rows: n } });
  return n;
}

/** Tests only: forget the per-instance throttles. */
export function __resetHistoryChecks(): void {
  checkedAt.clear();
  sweptAt = 0;
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
