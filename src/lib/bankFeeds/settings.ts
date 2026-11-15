// SERVER-ONLY. The company's Smart Suggestions settings: Auto-classification
// (Off / Suggest only / Fill in when sure). "Learn from history" lives with the
// history reader (history.ts).
import type { AutoClassification } from "@/lib/suggestions/match";

import type { Db } from "./db";
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
