// SERVER-ONLY. Suggesting the vendor, GL account and tax code for each bank
// line from the company's own past decisions, and coding a line by itself when
// the Autopilot checks pass.
//
// The Autopilot screen (components/v2/autopilot/OverviewPanel.tsx) states the
// rules for documents; these are the same rules applied to bank lines:
//   1. Legibility — the line is clean data: posted, a real date not in the
//      future, a non-zero amount, a description.
//   2. Completeness — one full destination: a payee and a GL account (and the
//      tax code, whenever past lines for this payee had one).
//   3. Historical consistency — "at least 3 similar past postings agree …
//      recent postings count for more than old ones": weighted votes from the
//      user's own decisions on lines with the same payee. Weight 1.0 if decided
//      within 90 days, 0.5 within a year, 0 older. Pass when the agreeing weight
//      is ≥ 3.0 AND ≥ 90% of all weight for that payee.
// When all three pass, ScanTrix fills in the coding itself (decided_by =
// "autopilot") and says so on the line; the user can change it. It never
// changes a line's status (exclude, transfer, match) by itself, and never posts.
//
// Smart Suggestions, step 1: the company's own coding in QuickBooks (the last
// 12 months, history.ts) counts like decisions a person made here, so a payee
// the books already know is suggested from day one. There are no ScanTrix
// rules: the company's rules live in QuickBooks (Saurabh, 13 Nov call).
//
// Step 2: every suggestion also carries the top 3 accounts (`picks`, from
// lib/suggestions/picks.ts) with the past lines behind each, for the account
// dropdown and "How ScanTrix decided". Once a person picks a vendor for a
// payee, the payee is linked to that vendor (payee_links), and later lines
// from that payee get that vendor.
import type { AnyBulkWriteOperation } from "mongodb";

import { payeeKey, type AutoClassification } from "@/lib/suggestions/match";
import { similarPicks, suggestedVendorName, type MemoryItem } from "@/lib/suggestions/similar";
import { pickReason } from "@/lib/suggestions/picks";
import { HISTORY_LABEL, historyPicks, isPrior, MIN_AGREEING_WEIGHT, MIN_AGREEMENT, postsReason, topPicks, voteWeight, type Evidence, type MemoryVote, type SuggestionPick } from "@/lib/suggestions/picks";

import type { Db } from "./db";
import { aiAccountsFor, aiPicksFrom, needsAi } from "./aiPick";
import { accountNames, bankSideIds, vendorTaxCodes } from "./companyLists";
import { historyMatches, loadHistory, readLearnFromHistory } from "./history";
import { loadMemory } from "./similarSync";
import type { HistoryDoc, PayeeLinkDoc, TxnDoc } from "./schema";
import { logEvent } from "./store";

// The payee key lives in lib/suggestions/match.ts, shared
// with the invoice review screen.
export { payeeKey } from "@/lib/suggestions/match";
export { MIN_AGREEING_WEIGHT, MIN_AGREEMENT, voteWeight } from "@/lib/suggestions/picks";

// ---------------------------------------------------------------- scoring

export type SuggestionKind = "expense" | "transfer" | "exclude" | "bill";

export interface Vote {
  kind: SuggestionKind;
  glAccountId: string | null;
  taxCodeId: string | null;
  vendorId: string | null;
  payee: string | null;
  transferLabel: string | null;
  decidedAt: string;
  /** The past line itself, shown as evidence. */
  evidence?: Evidence;
  /** History rows only: money out (true) or in, so a vendor's bills don't speak for its refunds. */
  out?: boolean;
}

/** A coded line from the company's books, as a past decision (history.ts). */
export function historyVote(h: Pick<HistoryDoc, "entity" | "glAccountId" | "taxCodeId" | "vendorId" | "vendorName" | "date" | "amountCents" | "credit" | "source">): Vote {
  const label = h.vendorName?.trim() || `${HISTORY_LABEL[h.source]} entry`;
  return {
    kind: h.entity === "BillPayment" ? "bill" : "expense",
    glAccountId: h.entity === "BillPayment" ? null : h.glAccountId,
    taxCodeId: h.entity === "BillPayment" ? null : h.taxCodeId,
    vendorId: h.vendorId,
    payee: h.vendorName?.trim() || null,
    transferLabel: null,
    decidedAt: `${h.date}T12:00:00.000Z`,
    evidence: { label, date: h.date, amountCents: h.amountCents, source: h.source },
    out: h.entity === "Deposit" ? false : h.entity === "Purchase" ? !h.credit : true,
  };
}

export interface CheckResult {
  ok: boolean;
  detail: string;
}

export interface Suggestion {
  kind: SuggestionKind | null;
  glAccountId?: string;
  taxCodeId?: string;
  vendorId?: string;
  payee?: string;
  transferLabel?: string;
  confidence: "high" | "medium" | "low";
  /** One plain sentence for the line. */
  reason: string;
  checks: { legibility: CheckResult; completeness: CheckResult; history: CheckResult };
  /** ScanTrix filled the coding in itself (all three checks passed). */
  autoCoded: boolean;
  /** Weighted votes behind the suggestion, and how many past lines. */
  basis: { agreeing: number; total: number; lines: number };
  /** Which step found it: this payee's history (here and in the books), similar past items (step 3), or the AI (step 4, last resort). */
  step: "history" | "similar" | "ai";
  /** Step 2: up to 3 accounts, best first, each with its reason and the past lines behind it. */
  picks?: SuggestionPick[];
  /** The vendor comes from the payee's link to a vendor, not from history. */
  linkedVendor?: boolean;
  /** Step 4 picks included: the AI model that made them ("openai:gpt-5.4-mini"). */
  model?: string;
  scoredAt: string;
}

// The vendor is who was paid, not part of the coding: lines coded to the same
// account agree even if one of them had no vendor picked yet. Tax is not part
// of it either: tax is the vendor's saved tax code, never learned from past
// lines (Saurabh, 18 Nov).
const groupKey = (v: Vote) => (v.kind === "expense" ? `expense|${v.glAccountId}` : v.kind === "transfer" ? `transfer|${v.transferLabel ?? ""}` : v.kind);

export interface ScoreOptions {
  /** Vendor id → its saved tax code (companyLists.ts). A vendor without one can't make a line sure. */
  vendorTax?: ReadonlyMap<string, string>;
  /** Account id → name (companyLists.ts), for the "coded differently" reason. */
  accountNames?: ReadonlyMap<string, string>;
}

function memoryVotes(votes: Vote[], fallbackLabel: string): MemoryVote[] {
  return votes
    .filter((v) => v.kind === "expense" && v.glAccountId)
    .map((v) => ({
      glAccountId: v.glAccountId as string,
      taxCodeId: v.taxCodeId,
      decidedAt: v.decidedAt,
      evidence: v.evidence ?? { label: v.payee ?? fallbackLabel, date: v.decidedAt.slice(0, 10), amountCents: null, source: "bank" as const },
    }));
}

/**
 * Who the history is about: the payee people wrote, when every past line
 * names that same payee; else the bank's name for it. ("You coded Dinesh
 * Bhatt to Cash 3 times" was wrong when only 2 of the 3 lines named him.)
 */
function subjectOf(votes: Vote[], fallback: string): string {
  const named = new Set(votes.map((v) => v.payee?.trim().toLowerCase() || ""));
  return named.size === 1 && !named.has("") ? (votes[0].payee as string).trim() : fallback;
}

export interface LineFacts {
  date: string;
  amountCents: number;
  description: string;
  pending?: boolean;
  payeeLabel: string;
}

export function legibility(line: LineFacts, today = new Date().toISOString().slice(0, 10)): CheckResult {
  if (line.pending) return { ok: false, detail: "This line is still pending at the bank." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(line.date) || line.date > today) return { ok: false, detail: "The date isn't a real past date." };
  if (!Number.isFinite(line.amountCents) || line.amountCents === 0) return { ok: false, detail: "The amount is zero." };
  if (!line.description.trim()) return { ok: false, detail: "The bank gave no description." };
  return { ok: true, detail: "Posted at the bank with a date, an amount and a description." };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Scores one line against the votes of past lines with the same payee. A
 * vendor a person linked to this payee (`link`) is the line's vendor: it
 * counts as known even when the past lines were coded without one.
 */
export function score(line: LineFacts, votes: Vote[], now = Date.now(), link?: Pick<PayeeLinkDoc, "vendorId" | "payee"> | null, opts: ScoreOptions = {}): Suggestion {
  const scoredAt = new Date(now).toISOString();
  const leg = legibility(line, new Date(now).toISOString().slice(0, 10));
  const weighted = votes.map((v) => ({ v, w: voteWeight(v.decidedAt, now) })).filter((x) => x.w > 0);
  const total = weighted.reduce((s, x) => s + x.w, 0);

  const groups = new Map<string, { vote: Vote; weight: number; lines: number }>();
  for (const { v, w } of weighted) {
    const k = groupKey(v);
    const g = groups.get(k) ?? { vote: v, weight: 0, lines: 0 };
    g.weight += w;
    g.lines += 1;
    // Keep the most recent vote as the representative (latest payee spelling).
    if (v.decidedAt > g.vote.decidedAt) g.vote = v;
    groups.set(k, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.weight - a.weight);
  const top = ranked[0];
  const empty: Suggestion = {
    kind: null,
    confidence: "low",
    reason: `New payee — no earlier decisions for ${line.payeeLabel} to learn from.`,
    checks: {
      legibility: leg,
      completeness: { ok: false, detail: "No vendor or GL account yet." },
      history: { ok: false, detail: "No earlier lines for this payee." },
    },
    autoCoded: false,
    basis: { agreeing: 0, total: 0, lines: 0 },
    step: "history",
    picks: [],
    ...(link ? { vendorId: link.vendorId, payee: link.payee ?? undefined, linkedVendor: true } : {}),
    scoredAt,
  };
  if (!top) return empty;

  const agreement = total > 0 ? top.weight / total : 0;
  // Agreeing means the same GL account, and no two different vendors among
  // them (a line coded without a vendor doesn't disagree).
  const vendorsInTop = new Set(weighted.filter((x) => groupKey(x.v) === groupKey(top.vote) && x.v.vendorId).map((x) => x.v.vendorId));
  const vendorsAgree = vendorsInTop.size <= 1;
  const historyOk = top.weight >= MIN_AGREEING_WEIGHT && agreement >= MIN_AGREEMENT && vendorsAgree;
  // Items read from the company's books are never dated or counted on screen,
  // only "From prior classifications" (Saurabh, 20 Nov; picks.ts).
  const topVotes = weighted.filter((x) => groupKey(x.v) === groupKey(top.vote)).map((x) => x.v).sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));
  const topPrior = topVotes.filter((x) => x.evidence && isPrior(x.evidence)).length;
  const anyPrior = weighted.some((x) => x.v.evidence && isPrior(x.v.evidence));
  const evidenceOf = (list: Vote[]) => list.map((x) => x.evidence).filter((e): e is Evidence => Boolean(e));
  const counted = (g: { vote: Vote; lines: number }) => (anyPrior ? describe(g.vote, opts.accountNames) : `${describe(g.vote, opts.accountNames)} ${g.lines}×`);
  const others = ranked.slice(1, 3).map(counted);
  const historyDetail = historyOk
    ? `${postsReason({ kind: "earlier", posted: top.lines - topPrior, prior: topPrior, account: describe(top.vote, opts.accountNames, "the same account"), evidence: evidenceOf(topVotes) })}.`
    : top.weight < MIN_AGREEING_WEIGHT
      ? anyPrior
        ? "Not enough agreeing posts yet — at least 3 are needed."
        : `Only ${fmt(top.weight)} recent agreeing ${top.weight === 1 ? "decision" : "decisions"} — at least 3 are needed.`
      : !vendorsAgree
        ? "Earlier lines for this payee were coded the same way but to different vendors."
      : `Earlier lines for this payee were coded differently (${[counted(top), ...others].join(", ")}).`;

  const v = top.vote;
  // Who was paid: the linked vendor, else the newest agreeing line that names a vendor or payee.
  const agreeing = weighted.map((x) => x.v).filter((x) => groupKey(x) === groupKey(v)).sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));
  const vendorId = link?.vendorId ?? v.vendorId ?? agreeing.find((x) => x.vendorId)?.vendorId ?? null;
  const payee = v.payee ?? link?.payee ?? agreeing.find((x) => x.payee)?.payee ?? null;
  // Tax: the vendor's saved tax code, or blank for a person to pick.
  const tax = vendorId ? (opts.vendorTax?.get(vendorId) ?? null) : null;
  const completeness: CheckResult =
    v.kind !== "expense"
      ? { ok: true, detail: v.kind === "transfer" ? "A transfer between your own accounts." : v.kind === "exclude" ? "Earlier lines like this were excluded." : "Earlier lines like this paid a bill." }
      : !v.glAccountId
        ? { ok: false, detail: "No GL account to suggest." }
        : !vendorId
          ? { ok: false, detail: "No vendor to suggest, so no tax code: pick the vendor and the tax code." }
          : !tax
            ? { ok: false, detail: "The vendor has no saved tax code: pick the tax code." }
            : { ok: true, detail: "Vendor and GL account are known, and the vendor's saved tax code." };

  const confidence = historyOk && leg.ok && completeness.ok ? "high" : agreement >= 0.6 ? "medium" : "low";
  const autoCoded = confidence === "high" && v.kind === "expense";
  const reason = autoCoded
    ? `Coded by ScanTrix — ${historyDetail.charAt(0).toLowerCase()}${historyDetail.slice(1)}`
    : !leg.ok
      ? leg.detail
      : !historyOk
        ? historyDetail
        : completeness.detail;

  // Top 3 accounts: the suggestion's own first (with its confidence, which
  // also weighs clean data and completeness), then the rest of the history.
  const subject = subjectOf(weighted.map((x) => x.v), line.payeeLabel);
  const fromHistory = historyPicks(memoryVotes(votes, line.payeeLabel), subject, now);
  const own = v.kind === "expense" && v.glAccountId ? fromHistory.find((p) => p.glAccountId === v.glAccountId) : undefined;
  const picks = topPicks(own ? [{ ...own, ...(tax ? { taxCodeId: tax } : {}), confidence }] : [], fromHistory.map((p) => (p.confidence === "high" ? { ...p, confidence: "medium" as const } : p)));

  return {
    kind: v.kind,
    glAccountId: v.glAccountId ?? undefined,
    taxCodeId: v.kind === "expense" ? (tax ?? undefined) : undefined,
    vendorId: vendorId ?? undefined,
    payee: payee ?? undefined,
    transferLabel: v.transferLabel ?? undefined,
    confidence,
    reason,
    checks: { legibility: leg, completeness, history: { ok: historyOk, detail: historyDetail } },
    autoCoded,
    basis: { agreeing: top.weight, total, lines: weighted.length },
    step: "history",
    picks,
    ...(link ? { linkedVendor: true } : {}),
    scoredAt,
  };
}

/** What a group of past lines was coded to, for "coded differently (…)". Every vote is for the same payee, so name the account. */
function describe(v: Vote, accountNames?: ReadonlyMap<string, string>, unknown = "another account"): string {
  if (v.kind === "transfer") return "transfer";
  if (v.kind === "exclude") return "excluded";
  if (v.kind === "bill") return "bill payment";
  return (v.glAccountId && accountNames?.get(v.glAccountId)) || unknown;
}

/**
 * Step 3's reason: "New payee. 3 similar posts went to Meals: Tim Hortons 12
 * Nov, 14 Nov; Second Cup 3 Nov." Items from the company's books are not
 * dated or counted (picks.ts postsReason).
 */
export function similarReason(pick: Pick<SuggestionPick, "lines" | "historyLines" | "evidence">, account: string): string {
  const prior = Math.min(pick.historyLines ?? 0, pick.lines);
  return `New payee. ${postsReason({ kind: "similar", posted: pick.lines - prior, prior, account, evidence: pick.evidence })}.`;
}

/** Auto-classification "Suggest only": the same suggestion, never filled in. */
export function suggestOnly(s: Suggestion): Suggestion {
  if (!s.autoCoded) return s;
  const reason = s.reason.replace(/^Coded by ScanTrix — /, "");
  return { ...s, autoCoded: false, reason: reason.charAt(0).toUpperCase() + reason.slice(1) };
}

// ---------------------------------------------------------------- persistence

/** The company's Auto-classification setting: "fill" until an Owner or Admin changes it. */
export async function readAutoClassification(db: Db, qbConnectionId: string): Promise<AutoClassification> {
  const doc = await db.suggestionSettings.findOne({ _id: qbConnectionId });
  return doc?.autoClassification ?? "fill";
}

type VoteRow = Pick<TxnDoc, "status" | "glAccountId" | "taxCodeId" | "vendorId" | "payee" | "transferLabel" | "decidedAt"> &
  Partial<Pick<TxnDoc, "date" | "amountCents" | "description" | "merchantName" | "counterpartyName">>;

/** A vote may count unless it codes a line to a Bank-type account (Cash included). */
function allowedVote(v: Vote, bankSide: ReadonlySet<string>): boolean {
  return v.kind !== "expense" || !v.glAccountId || !bankSide.has(v.glAccountId);
}

function toVote(r: VoteRow): Vote | null {
  const kind: SuggestionKind | null =
    r.status === "transfer" ? "transfer" : r.status === "excluded" ? "exclude" : r.status === "matched" ? "bill" : r.glAccountId ? "expense" : null;
  if (!kind || !r.decidedAt) return null;
  const evidence: Evidence | undefined = r.date
    ? { label: (r.payee ?? r.merchantName ?? r.counterpartyName ?? r.description ?? "").trim() || "Earlier line", date: r.date, amountCents: typeof r.amountCents === "number" ? Math.abs(r.amountCents) : null, source: "bank" }
    : undefined;
  return { kind, glAccountId: r.glAccountId, taxCodeId: r.taxCodeId, vendorId: r.vendorId, payee: r.payee, transferLabel: r.transferLabel, decidedAt: r.decidedAt.toISOString(), ...(evidence ? { evidence } : {}) };
}

/**
 * Re-scores every undecided line of a company (or only those with the given
 * payee keys) and codes the ones that pass all three checks. Called after a
 * sync, a CSV import, a history read, any decision the user makes, and any
 * change to the Auto-classification setting. Returns how many lines ScanTrix
 * coded by itself in this pass.
 *
 * Auto-classification: "off" clears every suggestion; "suggest" keeps them but
 * fills nothing in; either way, what ScanTrix filled in earlier is taken back.
 */
export async function refreshSuggestions(
  db: Db,
  qbConnectionId: string,
  onlyKeys?: string[],
): Promise<{ scored: number; autoCoded: number }> {
  // 1. Give every line its payee key (new lines from sync/import have none yet).
  const unkeyed = await db.txns
    .find({ qbConnectionId, payeeKey: null, removedAt: null }, { projection: { _id: 1, description: 1, merchantName: 1, counterpartyName: 1 } })
    .toArray();
  if (unkeyed.length > 0) {
    await db.txns.bulkWrite(
      unkeyed.map((r) => ({
        updateOne: { filter: { _id: r._id, qbConnectionId }, update: { $set: { payeeKey: payeeKey(r.merchantName ?? r.counterpartyName, r.description) } } },
      })),
      { ordered: false },
    );
  }
  const keyFilter = onlyKeys ? { payeeKey: { $in: onlyKeys } } : {};

  // 2. Votes: lines POSTED to QuickBooks/Xero (or matched and paid there) in
  //    the last year. "Jo posted hai, usi se suggestion lega" (Saurabh, 18 Nov):
  //    a choice nobody posted, or a line ScanTrix filled in itself, teaches
  //    nothing. A line found already entered in QuickBooks/Xero says nothing
  //    about coding. Bank-type accounts never vote: on a bank line that side is
  //    the line's own bank account.
  const [bankSide, vendorTax, names] = await Promise.all([bankSideIds(db, qbConnectionId), vendorTaxCodes(db, qbConnectionId), accountNames(db, qbConnectionId)]);
  const voteRows = await db.txns
    .find({
      qbConnectionId,
      removedAt: null,
      postingStatus: "posted",
      "posting.found": null,
      "posting.postedAt": { $gt: new Date(Date.now() - 365 * 86_400_000) },
      payeeKey: { $nin: [null, ""], ...(onlyKeys ? { $in: onlyKeys } : {}) },
    })
    .project<VoteRow & Pick<TxnDoc, "payeeKey" | "posting">>({
      payeeKey: 1, status: 1, glAccountId: 1, taxCodeId: 1, vendorId: 1, payee: 1, transferLabel: 1, decidedAt: 1,
      date: 1, amountCents: 1, description: 1, merchantName: 1, counterpartyName: 1, posting: 1,
    })
    .toArray();
  const votesByKey = new Map<string, Vote[]>();
  for (const r of voteRows) {
    const v = toVote({ ...r, decidedAt: r.posting?.postedAt ?? r.decidedAt });
    if (!v || !r.payeeKey || !allowedVote(v, bankSide)) continue;
    const list = votesByKey.get(r.payeeKey) ?? [];
    list.push(v);
    votesByKey.set(r.payeeKey, list);
  }

  // 3. Candidates: lines still to review that the user has not coded.
  const [candidates, mode, links] = await Promise.all([
    db.txns.find({ qbConnectionId, removedAt: null, status: "review", decidedBy: { $in: [null, "autopilot"] }, postingStatus: null, ...keyFilter }).toArray(),
    readAutoClassification(db, qbConnectionId),
    db.payeeLinks.find({ qbConnectionId, ...(onlyKeys ? { payeeKey: { $in: onlyKeys } } : {}) }).toArray(),
  ]);
  const vendorByKey = new Map(links.map((l) => [l.payeeKey, l]));

  // History: the company's own coding in QuickBooks/Xero counts like past
  // decisions, matched to a payee by the cleaned-up vendor name or through the
  // vendor a person linked to the payee (history.ts).
  const history = mode !== "off" && (await readLearnFromHistory(db, qbConnectionId)) ? await loadHistory(db, qbConnectionId, "bank") : [];
  const historyByName = new Map<string, Vote[]>();
  const historyByVendor = new Map<string, Vote[]>();
  for (const h of history) {
    const v = historyVote(h);
    if (!allowedVote(v, bankSide)) continue;
    if (h.nameKey) historyByName.set(h.nameKey, [...(historyByName.get(h.nameKey) ?? []), v]);
    if (h.vendorId) historyByVendor.set(h.vendorId, [...(historyByVendor.get(h.vendorId) ?? []), v]);
  }
  const historyNames = [...historyByName.keys()];

  // Step 3 reads the company's vectors once, and only if a line needs them.
  let memory: MemoryItem[] | null = null;
  let queries: Map<string, number[]> | null = null;
  const similarFor = async (c: TxnDoc, facts: LineFacts, link: PayeeLinkDoc | null): Promise<Suggestion | null> => {
    if (mode === "off") return null;
    if (!memory || !queries) {
      memory = (await loadMemory(db, qbConnectionId)).filter((m) => !bankSide.has(m.glAccountId));
      const docs = await db.vectors.find({ qbConnectionId, role: "query", kind: "bank" }, { projection: { ref: 1, vector: 1 } }).toArray();
      queries = new Map(docs.map((d) => [d.ref, d.vector]));
    }
    const vector = queries.get(c._id);
    if (!vector || memory.length === 0) return null;
    const picks = similarPicks({ vector, out: c.amountCents < 0 }, memory, now);
    if (picks.length === 0) return null;
    const top = picks[0];
    // A payee linked to a vendor (picked or created on an earlier line) keeps
    // that vendor and its saved tax code; otherwise the name to create.
    const tax = link ? vendorTax.get(link.vendorId) : undefined;
    return {
      kind: "expense",
      glAccountId: top.glAccountId,
      ...(tax ? { taxCodeId: tax } : {}),
      ...(link ? { vendorId: link.vendorId, linkedVendor: true } : {}),
      payee: (link?.payee ?? suggestedVendorName(c.merchantName ?? c.counterpartyName, c.description)) || undefined,
      confidence: top.confidence,
      reason: similarReason(top, names.get(top.glAccountId) ?? "the same account"),
      checks: {
        legibility: legibility(facts, new Date(now).toISOString().slice(0, 10)),
        completeness: { ok: false, detail: "New vendor: pick or create it." },
        history: { ok: false, detail: "No earlier lines for this payee; similar items from other vendors." },
      },
      autoCoded: false,
      basis: { agreeing: top.weight, total: picks.reduce((sum, p) => sum + p.weight, 0), lines: top.lines },
      step: "similar",
      picks,
      scoredAt: new Date(now).toISOString(),
    };
  };
  // Step 4: the AI's saved answer (aiPick.ts) for a line steps 2 and 3 have
  // nothing for, or where step 3 is below Medium. Always Low, never filled in.
  // An account no longer allowed drops out.
  const aiAllowed = mode === "off" ? null : (await aiAccountsFor(db, qbConnectionId)).ids;
  const withAi = (c: TxnDoc, link: PayeeLinkDoc | null, found: Suggestion): Suggestion => {
    const rec = c.aiPick;
    if (!rec || rec.status !== "ok" || !aiAllowed || !needsAi(found)) return found;
    const subject = (c.merchantName ?? c.counterpartyName ?? c.description).trim() || "this payee";
    const aiPicks = aiPicksFrom(rec, aiAllowed, subject);
    if (aiPicks.length === 0) return found;
    // Step 3 below Medium is weak: the AI's first pick leads, then step 3's and
    // the AI's take turns, so both show (a weak step 3 filling all 3 places hid
    // the AI entirely; 21 Nov sandbox).
    const weak = found.kind && found.step === "similar" ? (found.picks ?? []) : [];
    const turns = aiPicks.flatMap((p, i) => [p, ...(weak[i] ? [weak[i]] : [])]).concat(weak.slice(aiPicks.length));
    const top = aiPicks[0];
    const tax = link ? vendorTax.get(link.vendorId) : undefined;
    return {
      kind: "expense",
      glAccountId: top.glAccountId,
      ...(tax ? { taxCodeId: tax } : {}),
      ...(link ? { vendorId: link.vendorId, linkedVendor: true } : {}),
      payee: (link?.payee ?? suggestedVendorName(c.merchantName ?? c.counterpartyName, c.description)) || undefined,
      confidence: "low",
      reason: pickReason(top, names.get(top.glAccountId) ?? "this account"),
      checks: {
        legibility: found.checks.legibility,
        completeness: { ok: false, detail: link ? "Pick the account and check it." : "New vendor: pick or create it." },
        history: { ok: false, detail: "Nothing posted before is like this line, so this is an AI suggestion. Please review it." },
      },
      autoCoded: false,
      basis: { agreeing: 0, total: 0, lines: 0 },
      step: "ai",
      picks: topPicks(turns),
      model: rec.model,
      scoredAt: new Date(now).toISOString(),
    };
  };

  const historyCache = new Map<string, Vote[]>();
  const historyVotesFor = (lineKey: string, linkedVendorId: string | null, out: boolean): Vote[] => {
    if (history.length === 0) return [];
    const cacheKey = `${lineKey}|${linkedVendorId ?? ""}|${out}`;
    const cached = historyCache.get(cacheKey);
    if (cached) return cached;
    const found = new Set<Vote>();
    for (const n of historyNames) if (historyMatches(lineKey, n)) for (const v of historyByName.get(n) ?? []) found.add(v);
    if (linkedVendorId) for (const v of historyByVendor.get(linkedVendorId) ?? []) found.add(v);
    const votes = [...found].filter((v) => v.out === out);
    historyCache.set(cacheKey, votes);
    return votes;
  };

  let autoCoded = 0;
  const now = Date.now();
  // One round trip per line was slow on a large company (every setting change
  // re-scores all of them): plain suggestions go in one bulk write, and the
  // lines ScanTrix codes or uncodes are updated side by side.
  const plain: AnyBulkWriteOperation<TxnDoc>[] = [];
  // Audit: a suggestion that first appears or changes (step, account, confidence, past items, model).
  const shown: ReturnType<typeof shownEvent>[] = [];
  const coding: Promise<void>[] = [];
  const before = (c: TxnDoc) => ({ glAccountId: c.glAccountId, taxCodeId: c.taxCodeId, vendorId: c.vendorId, payee: c.payee });
  // Takes back what ScanTrix filled in by itself; the line keeps `suggestion` (null = none).
  const uncode = async (c: TxnDoc, suggestion: Suggestion | null, reason: string) => {
    const r = await db.txns.updateOne(
      { _id: c._id, qbConnectionId, status: "review", decidedBy: "autopilot" },
      { $set: { suggestion, glAccountId: null, taxCodeId: null, vendorId: null, payee: null, decidedBy: null, decidedAt: null, updatedAt: new Date() }, $inc: { version: 1 } },
    );
    if (r.modifiedCount === 1) {
      await logEvent(db, { qbConnectionId, transactionId: c._id, actor: "autopilot", action: "bank.autopilot_uncoded", detail: { before: before(c), after: null, reason } });
    }
  };

  for (const c of candidates) {
    // Guarded by the same conditions in the filter, so a decision the user makes
    // while this runs is never overwritten.
    const guard = { _id: c._id, qbConnectionId, status: "review" as const };
    if (mode === "off") {
      if (c.decidedBy === "autopilot") coding.push(uncode(c, null, "Auto-classification was switched off."));
      else if (c.suggestion != null) plain.push({ updateOne: { filter: { ...guard, decidedBy: null }, update: { $set: { suggestion: null, updatedAt: new Date() } } } });
      continue;
    }
    const key = c.payeeKey ?? "";
    const label = (c.merchantName ?? c.counterpartyName ?? c.description).trim() || "this payee";
    const facts = { date: c.date, amountCents: c.amountCents, description: c.description, payeeLabel: label };
    // A new line from sync has no key in memory yet; the bulk write above gave it one.
    const lineKey = c.payeeKey ?? payeeKey(c.merchantName ?? c.counterpartyName, c.description);
    // A payee a person linked to a vendor gets that vendor, even with no coding history yet.
    const link = vendorByKey.get(lineKey) ?? null;
    const pastVotes = [...(key ? (votesByKey.get(key) ?? []) : []), ...historyVotesFor(lineKey, link?.vendorId ?? null, c.amountCents < 0)];
    const fromHistory = score(facts, pastVotes, now, link, { vendorTax, accountNames: names });
    // Step 3: a payee nothing posted speaks for yet gets the accounts that
    // similar past items from any vendor went to. Never filled in. A linked
    // vendor alone (picked but never posted) doesn't stop it: it brings no
    // account, only the vendor and its saved tax code.
    const found = withAi(c, link, pastVotes.length === 0 ? ((await similarFor(c, facts, link)) ?? fromHistory) : fromHistory);
    const s = mode === "suggest" ? suggestOnly(found) : found;
    if (shownChanged(c.suggestion, s)) shown.push(shownEvent(qbConnectionId, c._id, s));
    if (s.autoCoded) {
      autoCoded += 1;
      const changed = c.decidedBy !== "autopilot" || c.glAccountId !== (s.glAccountId ?? null) || c.taxCodeId !== (s.taxCodeId ?? null);
      coding.push((async () => {
        const r = await db.txns.updateOne(
          { ...guard, decidedBy: { $in: [null, "autopilot"] } },
          {
            $set: { suggestion: s, glAccountId: s.glAccountId ?? null, taxCodeId: s.taxCodeId ?? null, vendorId: s.vendorId ?? null, payee: s.payee ?? null, decidedBy: "autopilot", decidedAt: new Date(), updatedAt: new Date() },
            $inc: { version: 1 },
          },
        );
        if (r.modifiedCount === 1 && changed) {
          await logEvent(db, {
            qbConnectionId,
            transactionId: c._id,
            actor: "autopilot",
            action: "bank.autopilot_coded",
            detail: {
              before: before(c),
              after: { glAccountId: s.glAccountId ?? null, taxCodeId: s.taxCodeId ?? null, vendorId: s.vendorId ?? null, payee: s.payee ?? null },
              reason: s.reason,
              step: s.step,
            },
          });
        }
      })());
    } else if (c.decidedBy === "autopilot") {
      // History or the setting no longer supports the coding ScanTrix chose: undo it, keep the explanation.
      coding.push(uncode(c, s, s.reason));
    } else {
      plain.push({ updateOne: { filter: { ...guard, decidedBy: null }, update: { $set: { suggestion: s, updatedAt: new Date() } } } });
    }
  }
  await Promise.all([plain.length > 0 ? db.txns.bulkWrite(plain, { ordered: false }) : null, ...coding, shown.length > 0 ? db.events.insertMany(shown, { ordered: false }) : null]);
  return { scored: candidates.length, autoCoded };
}

type Shown = Pick<Suggestion, "kind" | "step" | "glAccountId" | "confidence" | "picks">;
const pickIds = (s: Partial<Shown> | null | undefined) => (s?.picks ?? []).map((p) => `${p.glAccountId}:${p.step}`).join(",");

/** True when a line's suggestion first appears or changes in what a person sees (not on every re-score). */
export function shownChanged(before: unknown, after: Suggestion): boolean {
  const b = before as Partial<Shown> | null | undefined;
  if (!after.kind && !(after.picks?.length)) return Boolean(b?.kind);
  return !b || b.kind !== after.kind || b.step !== after.step || b.glAccountId !== after.glAccountId || b.confidence !== after.confidence || pickIds(b) !== pickIds(after);
}

/** The audit event for it: which step, the accounts, the past items behind it, and the AI model when step 4 is in it. */
function shownEvent(qbConnectionId: string, transactionId: string, s: Suggestion) {
  return {
    qbConnectionId,
    transactionId,
    itemId: null,
    actor: "autopilot",
    source: "autopilot" as const,
    action: "suggestion.shown",
    detail: {
      step: s.step,
      kind: s.kind,
      glAccountId: s.glAccountId ?? null,
      confidence: s.confidence,
      picks: (s.picks ?? []).map((p) => ({ glAccountId: p.glAccountId, step: p.step, confidence: p.confidence, evidence: p.evidence.map((e) => ({ label: e.label, date: e.date, source: e.source })) })),
      model: s.model ?? null,
      reason: s.reason,
    },
    at: new Date(),
  };
}

/**
 * Company memory for one vendor from bank lines (and, when "Learn from
 * QuickBooks or Xero history" is on, its entries in the books): the accounts
 * this vendor's lines were POSTED to in the last year. A choice nobody posted
 * doesn't count (Saurabh, 18 Nov).
 */
export async function vendorMemory(db: Db, qbConnectionId: string, vendorId: string): Promise<MemoryVote[]> {
  if (!vendorId) return [];
  const rows = await db.txns
    .find({
      qbConnectionId,
      vendorId,
      removedAt: null,
      status: "ready",
      glAccountId: { $ne: null },
      postingStatus: "posted",
      "posting.found": null,
      "posting.postedAt": { $gt: new Date(Date.now() - 365 * 86_400_000) },
    })
    .project<VoteRow & Pick<TxnDoc, "posting">>({ status: 1, glAccountId: 1, taxCodeId: 1, vendorId: 1, payee: 1, transferLabel: 1, decidedAt: 1, date: 1, amountCents: 1, description: 1, merchantName: 1, counterpartyName: 1, posting: 1 })
    .sort({ "posting.postedAt": -1 })
    .limit(500)
    .toArray();
  const fromBank = rows.map((r) => toVote({ ...r, decidedAt: r.posting?.postedAt ?? r.decidedAt })).filter((v): v is Vote => v !== null);
  // Plus the vendor's bills and expenses in the company's own books (history.ts).
  const fromBooks = (await readLearnFromHistory(db, qbConnectionId)) ? (await loadHistory(db, qbConnectionId, "invoice", { vendorId })).map(historyVote) : [];
  return memoryVotes([...fromBank, ...fromBooks], "Bank line");
}


/**
 * Called after a person's decision that set a vendor: links the line's payee
 * to that vendor for this company (one vendor per payee; the latest wins).
 */
export async function linkPayeeToVendor(db: Db, args: { qbConnectionId: string; payeeKey: string; vendorId: string; payee: string | null; userId: string }): Promise<boolean> {
  if (!args.payeeKey || !args.vendorId) return false;
  const _id = `${args.qbConnectionId}:${args.payeeKey}`;
  const before = await db.payeeLinks.findOne({ _id, qbConnectionId: args.qbConnectionId });
  if (before?.vendorId === args.vendorId) return false;
  await db.payeeLinks.updateOne(
    { _id, qbConnectionId: args.qbConnectionId },
    { $set: { payeeKey: args.payeeKey, vendorId: args.vendorId, payee: args.payee, linkedBy: args.userId, linkedAt: new Date() } },
    { upsert: true },
  );
  await logEvent(db, {
    qbConnectionId: args.qbConnectionId,
    transactionId: null,
    actor: args.userId,
    action: "suggestion.payee_linked",
    detail: { payeeKey: args.payeeKey, before: before ? { vendorId: before.vendorId } : null, after: { vendorId: args.vendorId } },
  });
  return true;
}

export async function payeeKeyOf(db: Db, qbConnectionId: string, id: string): Promise<string | null> {
  const row = await db.txns.findOne({ _id: id, qbConnectionId }, { projection: { payeeKey: 1, description: 1, merchantName: 1, counterpartyName: 1 } });
  if (!row) return null;
  return row.payeeKey ?? payeeKey(row.merchantName ?? row.counterpartyName, row.description);
}
