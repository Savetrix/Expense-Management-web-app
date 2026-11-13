// How a bank line is coded (vendor, GL account, tax code) and where that came
// from. Pure, so it can be tested without a screen; coding.ts re-exports it.
//
// A box shows a value only when it is saved on the line: chosen by a person,
// or filled in by Scantrix ("Fill in when sure", a High suggestion). Anything
// Scantrix only suggests (Medium, Low, or High with "Suggest only") stays out
// of the boxes: it is offered in the account dropdown, in the line dialog
// ("Use this") and, when High, in the "Scantrix is sure" section on top.
import type { SuggestionPick } from "@/lib/suggestions/picks";

import type { BankTransaction } from "./types";

/** The suggestion the server stores on a line (lib/bankFeeds/suggest.ts). */
export interface LineSuggestion {
  kind: "expense" | "transfer" | "exclude" | "bill" | null;
  glAccountId?: string;
  taxCodeId?: string;
  vendorId?: string;
  payee?: string;
  transferLabel?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  checks: Record<"legibility" | "completeness" | "history", { ok: boolean; detail: string }>;
  autoCoded: boolean;
  basis: { agreeing: number; total: number; lines: number };
  /** Which step found it: a company rule, or this payee's history. Absent on lines scored before rules existed. */
  step?: "rule" | "history";
  rule?: { id: string; match: "payee" | "description" | "category"; label: string };
  /** Step 2: the top 3 accounts, best first. Absent on lines scored before step 2. */
  picks?: SuggestionPick[];
  /** The vendor comes from the payee's link to a vendor a person picked. */
  linkedVendor?: boolean;
}

export function suggestionOf(txn: BankTransaction): LineSuggestion | null {
  const s = txn.suggestion as LineSuggestion | undefined;
  return s && typeof s === "object" && "reason" in s ? s : null;
}

export type CodingSource = "user" | "autopilot" | "none";

/** What Scantrix suggests for a line but hasn't filled in. */
export interface Offered {
  vendorId?: string;
  payee?: string;
  glAccountId?: string;
  taxCodeId?: string;
}

export interface Coding {
  vendorId?: string;
  payee?: string;
  glAccountId?: string;
  taxCodeId?: string;
  source: CodingSource;
  reason: string | null;
  suggestion: LineSuggestion | null;
  /** The suggestion, when it isn't in the boxes (nothing coded yet). */
  offered: Offered | null;
}

/** What a line shows: the user's own coding, Scantrix's coding, or nothing. */
export function codingFor(txn: BankTransaction): Coding {
  const suggestion = suggestionOf(txn);
  const own = { vendorId: txn.vendorId, payee: txn.payee, glAccountId: txn.categoryId, taxCodeId: txn.taxCodeId };
  const hasOwn = Boolean(own.vendorId || own.glAccountId || own.taxCodeId);
  // Scantrix coded it itself: the values are saved, but not yet confirmed by a person.
  if (hasOwn && suggestion?.autoCoded && own.glAccountId === suggestion.glAccountId) {
    return { ...own, source: "autopilot", reason: suggestion.reason, suggestion, offered: null };
  }
  const offered: Offered | null =
    txn.status === "review" && !own.glAccountId && suggestion?.kind === "expense" && suggestion.glAccountId
      ? { vendorId: suggestion.vendorId, payee: suggestion.payee, glAccountId: suggestion.glAccountId, taxCodeId: suggestion.taxCodeId }
      : txn.status === "review" && !hasOwn && suggestion?.linkedVendor && suggestion.vendorId
        ? { vendorId: suggestion.vendorId, payee: suggestion.payee }
        : null;
  if (hasOwn) return { ...own, source: "user", reason: suggestion?.reason ?? null, suggestion, offered };
  return { source: "none", reason: suggestion?.reason ?? null, suggestion, offered };
}

/** True when this field shows a value Scantrix filled in and no person has confirmed yet. */
export function isSuggestedField(txn: BankTransaction): boolean {
  return codingFor(txn).source === "autopilot";
}

/**
 * A line for the "Scantrix is sure" section: still to review, and Scantrix
 * either filled it in or has a High suggestion a person hasn't changed.
 */
export function isSureLine(txn: BankTransaction): boolean {
  if (txn.status !== "review" || txn.postingStatus) return false;
  const c = codingFor(txn);
  if (c.source === "autopilot") return Boolean(c.glAccountId);
  return c.source === "none" && c.suggestion?.confidence === "high" && c.suggestion.kind === "expense" && Boolean(c.suggestion.glAccountId);
}

/** What one click on a sure line saves: Post, with the vendor, GL and tax it shows. */
export function surePatch(txn: BankTransaction): Partial<BankTransaction> | null {
  if (!isSureLine(txn)) return null;
  const c = codingFor(txn);
  const v = c.source === "autopilot" ? c : (c.offered ?? {});
  if (!v.glAccountId) return null;
  return { status: "ready", vendorId: v.vendorId, categoryId: v.glAccountId, taxCodeId: v.taxCodeId, payee: v.payee ?? txn.payee };
}
