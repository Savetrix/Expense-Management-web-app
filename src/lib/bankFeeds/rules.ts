// SERVER-ONLY. Company rules for Smart Suggestions, step 1: "Always code Esso
// to Vehicle expense", and the company's Auto-classification setting. A rule
// belongs to the company (one QuickBooks or Xero file), never to the person who
// made it, and every query is scoped by qbConnectionId from the door. The
// matching itself is in lib/suggestions/match.ts.
//
// Every change re-scores the company's lines still to review, so a new rule
// fills in the lines it matches at once, and a deleted or broken rule takes its
// coding back (unless the payee's own history still supports it).
import { randomUUID } from "node:crypto";

import { normaliseWords, payeeKey, type AutoClassification } from "@/lib/suggestions/match";

import type { Db } from "./db";
import type { RuleDoc, RuleMatch } from "./schema";
import { logEvent } from "./store";
import { readAutoClassification, refreshSuggestions } from "./suggest";

const MATCHES: RuleMatch[] = ["payee", "description", "category"];

/** A rule may not point at an account that is no longer active. */
export const GONE_ACCOUNT = "That GL account isn't active in the accounting software any more. Pick another one.";

/** The browser's shape (store/bankFeeds/bankFeedsApi.ts SuggestionRuleDto). */
export interface RuleView {
  id: string;
  match: RuleMatch;
  value: string;
  label: string;
  glAccountId: string;
  taxCodeId: string | null;
  /** The GL account is no longer active in QuickBooks/Xero, so the rule is skipped. */
  broken: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toRuleView(r: RuleDoc): RuleView {
  return {
    id: r._id,
    match: r.match,
    value: r.value,
    label: r.label,
    glAccountId: r.glAccountId,
    taxCodeId: r.taxCodeId,
    broken: Boolean(r.brokenAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface RuleInput {
  match: RuleMatch;
  value: string;
  label: string;
  glAccountId: string;
  taxCodeId: string | null;
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Reads a rule from a request body. Returns an error string when invalid. */
export function readRule(body: Record<string, unknown>): RuleInput | string {
  const match = body.match as RuleMatch;
  if (!MATCHES.includes(match)) return "Pick what the rule looks at.";
  const label = text(body.label, 120);
  const glAccountId = text(body.glAccountId, 64);
  const taxCodeId = text(body.taxCodeId, 64) || null;
  if (!glAccountId) return "Pick the GL account the rule codes to.";
  if (match === "payee") {
    const value = payeeKey(null, label);
    if (!value) return "Type the vendor or payee name as the bank shows it.";
    return { match, value, label, glAccountId, taxCodeId };
  }
  if (match === "description") {
    const value = normaliseWords(label);
    if (value.length < 3) return "Type at least 3 letters the description must contain.";
    return { match, value, label, glAccountId, taxCodeId };
  }
  // Plaid's categories are upper-case codes, e.g. GAS_STATIONS.
  const value = label.toUpperCase();
  if (!/^[A-Z_]{3,80}$/.test(value)) return "That isn't one of Plaid's categories.";
  return { match, value, label: value, glAccountId, taxCodeId };
}

export async function listRules(db: Db, qbConnectionId: string): Promise<RuleView[]> {
  const rows = await db.rules.find({ qbConnectionId }).sort({ updatedAt: -1 }).limit(1000).toArray();
  return rows.map(toRuleView);
}

/** How many lines to review the rule filled in (or, with "Suggest only", suggested on), after the re-score. */
export interface RuleSaved {
  rule: RuleView;
  filled: number;
  autoClassification: AutoClassification;
}

export async function createRule(db: Db, args: { qbConnectionId: string; userId: string; input: RuleInput }): Promise<RuleSaved> {
  const now = new Date();
  const doc: RuleDoc = {
    _id: randomUUID(),
    qbConnectionId: args.qbConnectionId,
    ...args.input,
    brokenAt: null,
    createdBy: args.userId,
    createdAt: now,
    updatedBy: args.userId,
    updatedAt: now,
  };
  await db.rules.insertOne(doc);
  await logEvent(db, { qbConnectionId: args.qbConnectionId, actor: args.userId, action: "suggestion.rule_created", detail: { before: null, after: toRuleView(doc) } });
  return saved(db, args.qbConnectionId, doc);
}

async function saved(db: Db, qbConnectionId: string, doc: RuleDoc): Promise<RuleSaved> {
  const [out, autoClassification] = await Promise.all([refreshSuggestions(db, qbConnectionId), readAutoClassification(db, qbConnectionId)]);
  return { rule: toRuleView(doc), filled: out.byRule[doc._id] ?? 0, autoClassification };
}

export async function updateRule(db: Db, args: { qbConnectionId: string; userId: string; id: string; input: RuleInput }): Promise<RuleSaved | null> {
  const before = await db.rules.findOne({ _id: args.id, qbConnectionId: args.qbConnectionId });
  if (!before) return null;
  const updated = await db.rules.findOneAndUpdate(
    { _id: args.id, qbConnectionId: args.qbConnectionId },
    // Saving picks the account again, so a broken rule is fixed (the route checks the account first).
    { $set: { ...args.input, brokenAt: null, updatedBy: args.userId, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) return null;
  await logEvent(db, {
    qbConnectionId: args.qbConnectionId,
    actor: args.userId,
    action: "suggestion.rule_updated",
    detail: { before: toRuleView(before), after: toRuleView(updated) },
  });
  return saved(db, args.qbConnectionId, updated);
}

export async function deleteRule(db: Db, args: { qbConnectionId: string; userId: string; id: string }): Promise<boolean> {
  const removed = await db.rules.findOneAndDelete({ _id: args.id, qbConnectionId: args.qbConnectionId });
  if (!removed) return false;
  await logEvent(db, { qbConnectionId: args.qbConnectionId, actor: args.userId, action: "suggestion.rule_deleted", detail: { before: toRuleView(removed), after: null } });
  await refreshSuggestions(db, args.qbConnectionId);
  return true;
}

/**
 * Marks rules whose GL account is gone as broken (they are skipped), and
 * un-marks rules whose account is back. `isGone` answers for one account id
 * (accountCheck.ts). Re-scores the company when anything changed. Returns how
 * many rules changed.
 */
export async function markBrokenRules(db: Db, args: { qbConnectionId: string; isGone: (glAccountId: string) => boolean }): Promise<number> {
  const rules = await db.rules.find({ qbConnectionId: args.qbConnectionId }).toArray();
  let changed = 0;
  for (const r of rules) {
    const gone = args.isGone(r.glAccountId);
    if (gone === Boolean(r.brokenAt)) continue;
    const res = await db.rules.updateOne({ _id: r._id, qbConnectionId: args.qbConnectionId, updatedAt: r.updatedAt }, { $set: { brokenAt: gone ? new Date() : null } });
    if (res.modifiedCount !== 1) continue;
    changed += 1;
    await logEvent(db, {
      qbConnectionId: args.qbConnectionId,
      actor: "system",
      action: gone ? "suggestion.rule_broken" : "suggestion.rule_fixed",
      detail: { ruleId: r._id, glAccountId: r.glAccountId, reason: gone ? "The GL account is no longer active in the accounting software." : "The GL account is active again." },
    });
  }
  if (changed > 0) await refreshSuggestions(db, args.qbConnectionId);
  return changed;
}

/** Changes the company's Auto-classification setting and applies it to the lines to review at once. */
export async function setAutoClassification(db: Db, args: { qbConnectionId: string; userId: string; mode: AutoClassification }): Promise<AutoClassification> {
  const before = await readAutoClassification(db, args.qbConnectionId);
  if (before === args.mode) return before;
  await db.suggestionSettings.updateOne(
    { _id: args.qbConnectionId },
    { $set: { autoClassification: args.mode, updatedBy: args.userId, updatedAt: new Date() } },
    { upsert: true },
  );
  await logEvent(db, { qbConnectionId: args.qbConnectionId, actor: args.userId, action: "suggestion.settings_changed", detail: { before: { autoClassification: before }, after: { autoClassification: args.mode } } });
  await refreshSuggestions(db, args.qbConnectionId);
  return args.mode;
}
