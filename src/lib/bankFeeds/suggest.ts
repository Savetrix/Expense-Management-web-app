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
// When all three pass, Scantrix fills in the coding itself (decided_by =
// "autopilot") and says so on the line; the user can change it. It never
// changes a line's status (exclude, transfer, match) by itself, and never posts.
//
// Smart Suggestions, step 1: a company rule ("Always code Esso to Vehicle
// expense", rules.ts) comes before the history above. A rule is the company's
// own instruction, so it counts as sure even for a payee seen for the first
// time, and the line is filled in when the line itself is clean data.
import type { AnyBulkWriteOperation } from "mongodb";

import { payeeKey, ruleFor, ruleSubject, type AutoClassification } from "@/lib/suggestions/match";

import type { Db } from "./db";
import type { RuleDoc, RuleMatch, TxnDoc } from "./schema";
import { logEvent } from "./store";

// The payee key and rule matching live in lib/suggestions/match.ts, shared
// with the invoice review screen.
export { payeeKey } from "@/lib/suggestions/match";

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
  /** Scantrix filled the coding in itself (all three checks passed). */
  autoCoded: boolean;
  /** Weighted votes behind the suggestion, and how many past lines. */
  basis: { agreeing: number; total: number; lines: number };
  /** Which step found it: a company rule, or this payee's history. */
  step: "rule" | "history";
  /** The rule behind a step-1 suggestion. */
  rule?: { id: string; match: RuleMatch; label: string };
  scoredAt: string;
}

const DAY = 86_400_000;
export const MIN_AGREEING_WEIGHT = 3.0;
export const MIN_AGREEMENT = 0.9;

export function voteWeight(decidedAt: string, now = Date.now()): number {
  const age = (now - new Date(decidedAt).getTime()) / DAY;
  if (age <= 90) return 1;
  if (age <= 365) return 0.5;
  return 0;
}

const groupKey = (v: Vote) =>
  v.kind === "expense" ? `expense|${v.glAccountId}|${v.taxCodeId ?? ""}|${v.vendorId ?? ""}` : v.kind === "transfer" ? `transfer|${v.transferLabel ?? ""}` : v.kind;

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

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Scores one line against the votes of past lines with the same payee. */
export function score(line: LineFacts, votes: Vote[], now = Date.now()): Suggestion {
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
    scoredAt,
  };
  if (!top) return empty;

  const agreement = total > 0 ? top.weight / total : 0;
  const historyOk = top.weight >= MIN_AGREEING_WEIGHT && agreement >= MIN_AGREEMENT;
  const others = ranked.slice(1, 3).map((g) => `${describe(g.vote)} ${g.lines}×`);
  const historyDetail = historyOk
    ? `${plural(top.lines, "earlier line")} for this payee were coded the same way.`
    : top.weight < MIN_AGREEING_WEIGHT
      ? `Only ${fmt(top.weight)} recent agreeing ${top.weight === 1 ? "decision" : "decisions"} — at least 3 are needed.`
      : `Earlier lines for this payee were coded differently (${[`${describe(top.vote)} ${top.lines}×`, ...others].join(", ")}).`;

  const v = top.vote;
  const anyTax = weighted.some((x) => x.v.taxCodeId);
  const completeness: CheckResult =
    v.kind !== "expense"
      ? { ok: true, detail: v.kind === "transfer" ? "A transfer between your own accounts." : v.kind === "exclude" ? "Earlier lines like this were excluded." : "Earlier lines like this paid a bill." }
      : !v.glAccountId
        ? { ok: false, detail: "No GL account to suggest." }
        : !v.vendorId && !v.payee
          ? { ok: false, detail: "No vendor to suggest." }
          : anyTax && !v.taxCodeId
            ? { ok: false, detail: "Earlier lines for this payee had a tax code, the latest did not." }
            : { ok: true, detail: "Vendor and GL account are known" + (v.taxCodeId ? ", and the tax code." : ".") };

  const confidence = historyOk && leg.ok && completeness.ok ? "high" : agreement >= 0.6 ? "medium" : "low";
  const autoCoded = confidence === "high" && v.kind === "expense";
  const reason = autoCoded
    ? `Coded by Scantrix — ${historyDetail.charAt(0).toLowerCase()}${historyDetail.slice(1)}`
    : !leg.ok
      ? leg.detail
      : !historyOk
        ? historyDetail
        : completeness.detail;

  return {
    kind: v.kind,
    glAccountId: v.glAccountId ?? undefined,
    taxCodeId: v.taxCodeId ?? undefined,
    vendorId: v.vendorId ?? undefined,
    payee: v.payee ?? undefined,
    transferLabel: v.transferLabel ?? undefined,
    confidence,
    reason,
    checks: { legibility: leg, completeness, history: { ok: historyOk, detail: historyDetail } },
    autoCoded,
    basis: { agreeing: top.weight, total, lines: weighted.length },
    step: "history",
    scoredAt,
  };
}

// ---------------------------------------------------------------- rules

export type RuleLike = Pick<RuleDoc, "_id" | "match" | "value" | "label" | "glAccountId" | "taxCodeId" | "updatedAt">;

/**
 * Step 1: the rule's GL account and tax code. The vendor and payee come from
 * this payee's history when there is one (`history`), since a rule names only
 * the coding.
 */
export function scoreWithRule(line: LineFacts, rule: RuleLike, history: Suggestion | null, now = Date.now()): Suggestion {
  const leg = legibility(line, new Date(now).toISOString().slice(0, 10));
  const subject = ruleSubject(rule);
  const fromHistory = history?.kind === "expense" ? history : null;
  return {
    kind: "expense",
    glAccountId: rule.glAccountId,
    taxCodeId: rule.taxCodeId ?? undefined,
    vendorId: fromHistory?.vendorId,
    payee: fromHistory?.payee,
    confidence: "high",
    reason: leg.ok ? `Coded by Scantrix — your company rule for ${subject}.` : leg.detail,
    checks: {
      legibility: leg,
      completeness: { ok: true, detail: "The rule gives the GL account" + (rule.taxCodeId ? " and the tax code." : ".") },
      history: { ok: true, detail: `Your company rule for ${subject}. A rule is your own instruction, so it counts even for a new payee.` },
    },
    autoCoded: leg.ok,
    basis: { agreeing: 0, total: 0, lines: 0 },
    step: "rule",
    rule: { id: rule._id, match: rule.match, label: rule.label },
    scoredAt: new Date(now).toISOString(),
  };
}

function describe(v: Vote): string {
  if (v.kind === "transfer") return "transfer";
  if (v.kind === "exclude") return "excluded";
  if (v.kind === "bill") return "bill payment";
  return v.payee ? `${v.payee}` : "expense";
}

/** Auto-classification "Suggest only": the same suggestion, never filled in. */
export function suggestOnly(s: Suggestion): Suggestion {
  if (!s.autoCoded) return s;
  const reason = s.reason.replace(/^Coded by Scantrix — /, "");
  return { ...s, autoCoded: false, reason: reason.charAt(0).toUpperCase() + reason.slice(1) };
}

// ---------------------------------------------------------------- persistence

/** The company's Auto-classification setting: "fill" until an Owner or Admin changes it. */
export async function readAutoClassification(db: Db, qbConnectionId: string): Promise<AutoClassification> {
  const doc = await db.suggestionSettings.findOne({ _id: qbConnectionId });
  return doc?.autoClassification ?? "fill";
}

function toVote(r: Pick<TxnDoc, "status" | "glAccountId" | "taxCodeId" | "vendorId" | "payee" | "transferLabel" | "decidedAt">): Vote | null {
  const kind: SuggestionKind | null =
    r.status === "transfer" ? "transfer" : r.status === "excluded" ? "exclude" : r.status === "matched" ? "bill" : r.glAccountId ? "expense" : null;
  if (!kind || !r.decidedAt) return null;
  return { kind, glAccountId: r.glAccountId, taxCodeId: r.taxCodeId, vendorId: r.vendorId, payee: r.payee, transferLabel: r.transferLabel, decidedAt: r.decidedAt.toISOString() };
}

/**
 * Re-scores every undecided line of a company (or only those with the given
 * payee keys) and codes the ones that pass all three checks, or that a company
 * rule matches. Called after a sync, a CSV import, any decision the user makes,
 * and any change to the rules or the Auto-classification setting. Returns how
 * many lines Scantrix coded by itself in this pass, and how many lines each
 * rule filled in (or, with "Suggest only", suggested on).
 *
 * Auto-classification: "off" clears every suggestion; "suggest" keeps them but
 * fills nothing in; either way, what Scantrix filled in earlier is taken back.
 * A rule marked broken (its account is gone) is skipped.
 */
export async function refreshSuggestions(
  db: Db,
  qbConnectionId: string,
  onlyKeys?: string[],
): Promise<{ scored: number; autoCoded: number; byRule: Record<string, number> }> {
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

  // 2. Votes: the USER's own decisions in the last year. Lines Scantrix coded by
  //    itself do not vote, or one early guess would keep confirming itself.
  const voteRows = await db.txns
    .find({
      qbConnectionId,
      removedAt: null,
      decidedAt: { $gt: new Date(Date.now() - 365 * 86_400_000) },
      decidedBy: { $nin: [null, "autopilot"] },
      payeeKey: { $nin: [null, ""], ...(onlyKeys ? { $in: onlyKeys } : {}) },
    })
    .project<Pick<TxnDoc, "payeeKey" | "status" | "glAccountId" | "taxCodeId" | "vendorId" | "payee" | "transferLabel" | "decidedAt">>({
      payeeKey: 1, status: 1, glAccountId: 1, taxCodeId: 1, vendorId: 1, payee: 1, transferLabel: 1, decidedAt: 1,
    })
    .toArray();
  const votesByKey = new Map<string, Vote[]>();
  for (const r of voteRows) {
    const v = toVote(r);
    if (!v || !r.payeeKey) continue;
    const list = votesByKey.get(r.payeeKey) ?? [];
    list.push(v);
    votesByKey.set(r.payeeKey, list);
  }

  // 3. Candidates: lines still to review that the user has not coded.
  const [candidates, rules, mode] = await Promise.all([
    db.txns.find({ qbConnectionId, removedAt: null, status: "review", decidedBy: { $in: [null, "autopilot"] }, postingStatus: null, ...keyFilter }).toArray(),
    db.rules.find({ qbConnectionId, brokenAt: null }).toArray(),
    readAutoClassification(db, qbConnectionId),
  ]);

  let autoCoded = 0;
  const byRule: Record<string, number> = {};
  const now = Date.now();
  // One round trip per line was slow on a large company (every rule change
  // re-scores all of them): plain suggestions go in one bulk write, and the
  // lines Scantrix codes or uncodes are updated side by side.
  const plain: AnyBulkWriteOperation<TxnDoc>[] = [];
  const coding: Promise<void>[] = [];
  const before = (c: TxnDoc) => ({ glAccountId: c.glAccountId, taxCodeId: c.taxCodeId, vendorId: c.vendorId, payee: c.payee });
  // Takes back what Scantrix filled in by itself; the line keeps `suggestion` (null = none).
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
    const fromHistory = score(facts, key ? (votesByKey.get(key) ?? []) : [], now);
    // A new line from sync has no key in memory yet; the bulk write above gave it one.
    const rule = ruleFor(rules, { ...c, payeeKey: c.payeeKey ?? payeeKey(c.merchantName ?? c.counterpartyName, c.description) });
    const found = rule ? scoreWithRule(facts, rule, fromHistory, now) : fromHistory;
    const s = mode === "suggest" ? suggestOnly(found) : found;
    if (rule && (s.autoCoded || mode === "suggest")) byRule[rule._id] = (byRule[rule._id] ?? 0) + 1;
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
              ...(s.rule ? { ruleId: s.rule.id } : {}),
            },
          });
        }
      })());
    } else if (c.decidedBy === "autopilot") {
      // History, a rule or the setting no longer supports the coding Scantrix chose: undo it, keep the explanation.
      coding.push(uncode(c, s, s.reason));
    } else {
      plain.push({ updateOne: { filter: { ...guard, decidedBy: null }, update: { $set: { suggestion: s, updatedAt: new Date() } } } });
    }
  }
  await Promise.all([plain.length > 0 ? db.txns.bulkWrite(plain, { ordered: false }) : null, ...coding]);
  return { scored: candidates.length, autoCoded, byRule };
}

export async function payeeKeyOf(db: Db, qbConnectionId: string, id: string): Promise<string | null> {
  const row = await db.txns.findOne({ _id: id, qbConnectionId }, { projection: { payeeKey: 1, description: 1, merchantName: 1, counterpartyName: 1 } });
  if (!row) return null;
  return row.payeeKey ?? payeeKey(row.merchantName ?? row.counterpartyName, row.description);
}
