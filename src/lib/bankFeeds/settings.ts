// SERVER-ONLY. The company's Smart Suggestions settings: Auto-classification
// (Off / Suggest only / Fill in when sure). "Learn from history" lives with the
// history reader (history.ts).
import type { AutoClassification } from "@/lib/suggestions/match";

import type { Db } from "./db";
import type { FeatureKey } from "./schema";
import { logEvent } from "./store";
import { readAutoClassification, refreshSuggestions } from "./suggest";

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

/**
 * The 24 Nov features, each switchable per company without a code change (in
 * case one causes trouble in beta). Unset = off (27 Nov): a company gets them
 * only once they are switched on for it.
 *   aiPrefill           — the best suggestion shown in the boxes with an AI sign
 *   receiptWarning      — "Post it anyway?" when nothing is attached
 *   autoMatch           — suggested bill matches, open bills read from QuickBooks/Xero, "Post bill and pay"
 *   transferSuggestions — suggested transfer pairs
 */
export const FEATURE_KEYS: FeatureKey[] = ["aiPrefill", "receiptWarning", "autoMatch", "transferSuggestions"];
export type Features = Record<FeatureKey, boolean>;

export async function readFeatures(db: Db, qbConnectionId: string): Promise<Features> {
  const doc = await db.suggestionSettings.findOne({ _id: qbConnectionId }, { projection: { features: 1 } });
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, doc?.features?.[k] === true])) as Features;
}

/** Saves the switches given (unknown keys ignored); the others keep their value. */
export async function setFeatures(db: Db, args: { qbConnectionId: string; userId: string; features: Record<string, unknown> }): Promise<Features> {
  const before = await readFeatures(db, args.qbConnectionId);
  const set: Record<string, boolean> = {};
  for (const k of FEATURE_KEYS) if (typeof args.features[k] === "boolean" && args.features[k] !== before[k]) set[`features.${k}`] = args.features[k] as boolean;
  if (Object.keys(set).length === 0) return before;
  await db.suggestionSettings.updateOne({ _id: args.qbConnectionId }, { $set: { ...set, updatedBy: args.userId, updatedAt: new Date() } }, { upsert: true });
  const after = await readFeatures(db, args.qbConnectionId);
  await logEvent(db, { qbConnectionId: args.qbConnectionId, actor: args.userId, action: "suggestion.settings_changed", detail: { before: { features: before }, after: { features: after } } });
  return after;
}
