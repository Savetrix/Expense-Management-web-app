// How a bank line is coded (vendor, GL account, tax code) and where that came
// from. Pure, so it can be tested without a screen; coding.ts re-exports it.
//
// A box shows a value only when it is saved on the line: chosen by a person,
// or filled in by ScanTrix ("Fill in when sure", a High suggestion). Anything
// ScanTrix only suggests (Medium, Low, or High with "Suggest only") stays out
// of the boxes: it is offered in the account dropdown, in the line dialog
// ("Use this") and, when High, in the "ScanTrix is sure" section on top.
import type { AutoClassification } from "@/lib/suggestions/match";
import type { SuggestionPick } from "@/lib/suggestions/picks";
import { prefillTaxCode } from "@/lib/suggestions/prefill";

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
  /** Which step found it: this payee's history (here or in the books), similar past items (step 3), or the AI (step 4). */
  step?: "history" | "similar" | "ai";
  /** Step 2: the top 3 accounts, best first. Absent on lines scored before step 2. */
  picks?: SuggestionPick[];
  /** The vendor comes from the payee's link to a vendor a person picked. */
  linkedVendor?: boolean;
  /** Step 4 picks included: the AI model that made them. */
  model?: string;
}

export function suggestionOf(txn: BankTransaction): LineSuggestion | null {
  const s = txn.suggestion as LineSuggestion | undefined;
  return s && typeof s === "object" && "reason" in s ? s : null;
}

export type CodingSource = "user" | "autopilot" | "none";

/** What ScanTrix suggests for a line but hasn't filled in. */
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

/** What a line shows: the user's own coding, ScanTrix's coding, or nothing. */
export function codingFor(txn: BankTransaction): Coding {
  const suggestion = suggestionOf(txn);
  const own = { vendorId: txn.vendorId, payee: txn.payee, glAccountId: txn.categoryId, taxCodeId: txn.taxCodeId };
  const hasOwn = Boolean(own.vendorId || own.glAccountId || own.taxCodeId);
  // ScanTrix coded it itself: the values are saved, but not yet confirmed by a person.
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

/** True when this field shows a value ScanTrix filled in and no person has confirmed yet. */
export function isSuggestedField(txn: BankTransaction): boolean {
  return codingFor(txn).source === "autopilot";
}

/**
 * A line for the "ScanTrix is sure" section: still to review, and ScanTrix
 * either filled it in or has a High suggestion a person hasn't changed.
 */
export function isSureLine(txn: BankTransaction, mode: AutoClassification = "fill"): boolean {
  // Suggest only: no "sure" group; every suggestion is filled in place instead (24 Nov).
  if (mode !== "fill" || txn.status !== "review" || txn.postingStatus) return false;
  const c = codingFor(txn);
  if (c.source === "autopilot") return Boolean(c.glAccountId);
  return c.source === "none" && c.suggestion?.confidence === "high" && c.suggestion.kind === "expense" && Boolean(c.suggestion.glAccountId);
}

/** What one click on a sure line saves: Post, with the vendor, GL and tax it shows. */
export function surePatch(txn: BankTransaction, mode: AutoClassification = "fill"): Partial<BankTransaction> | null {
  if (!isSureLine(txn, mode)) return null;
  const c = codingFor(txn);
  const v = c.source === "autopilot" ? c : (c.offered ?? {});
  if (!v.glAccountId) return null;
  return { status: "ready", vendorId: v.vendorId, categoryId: v.glAccountId, taxCodeId: v.taxCodeId, payee: v.payee ?? txn.payee };
}

// ------------------------------------------------------------ AI pre-fill
//
// Saurabh, 24 Nov: show the best suggestion already in the GL, vendor and tax
// boxes, with an AI sign, instead of only in the dropdown. Nothing is saved
// until a person changes a box or clicks Post on that line: a pre-filled line
// never posts by itself and is never part of "Post all" / "Accept all".
//   Off          — nothing.
//   Suggest only — every suggestion (steps 2, 3 and 4) is filled in place.
//   Fill in when sure — the sure lines stay in their group on top; every other
//                  line with a suggestion is filled in place.

export type PrefillField = "glAccountId" | "vendorId" | "taxCodeId";

export interface Prefill {
  glAccountId?: string;
  /** An existing vendor the suggestion points to. */
  vendorId?: string;
  /** No such vendor yet: the clean name for "+ Add". */
  newVendorName?: string;
  taxCodeId?: string;
  taxSource?: "vendor" | "similar";
  /** The hover text: the same reason the dropdown shows. */
  reason: string;
  step: "history" | "similar" | "ai";
}

export interface PrefillContext {
  mode: AutoClassification;
  /** Per-company switch (Autopilot > Settings). */
  enabled: boolean;
  vendorTax: (vendorId: string) => string | null | undefined;
  /** An existing vendor with this name (case and punctuation ignored), if any. */
  vendorIdByName: (name: string) => string | undefined;
  /** The reason the dropdown shows for this account, history dates hidden. */
  reasonFor?: (txn: BankTransaction, glAccountId: string) => string | undefined;
}

/** What ScanTrix fills into an untouched line's boxes, or null. */
export function prefillFor(txn: BankTransaction, ctx: PrefillContext): Prefill | null {
  if (!ctx.enabled || ctx.mode === "off" || txn.status !== "review" || txn.postingStatus) return null;
  const s = suggestionOf(txn);
  if (!s || s.kind !== "expense" || !s.glAccountId) return null;
  if (isSureLine(txn, ctx.mode) || codingFor(txn).source === "autopilot") return null;
  const step = s.step ?? "history";
  const vendorId = s.vendorId || (s.payee ? ctx.vendorIdByName(s.payee) : undefined);
  // Tax: the vendor's own code, else what similar posted items on this account agree on. Never the AI's.
  const similarVotes = (s.picks ?? []).find((p) => p.step === "similar" && p.glAccountId === s.glAccountId)?.taxVotes;
  const tax = prefillTaxCode({ vendorTaxCodeId: (vendorId ? ctx.vendorTax(vendorId) : null) ?? (s.vendorId ? s.taxCodeId : null), similarTaxCodes: similarVotes });
  return {
    glAccountId: s.glAccountId,
    ...(vendorId ? { vendorId } : s.payee ? { newVendorName: s.payee } : {}),
    ...(tax ? { taxCodeId: tax.taxCodeId, taxSource: tax.source } : {}),
    reason: ctx.reasonFor?.(txn, s.glAccountId) ?? s.reason,
    step,
  };
}

export interface ShownCoding {
  vendorId?: string;
  payee?: string;
  glAccountId?: string;
  taxCodeId?: string;
  /** The boxes showing an AI-filled value no person has touched. */
  ai: Set<PrefillField>;
}

/** What each box shows: the person's (or ScanTrix's saved) value, else the pre-fill with its AI sign. */
export function shownCoding(txn: BankTransaction, prefill: Prefill | null): ShownCoding {
  const c = codingFor(txn);
  const ai = new Set<PrefillField>();
  const pick = <K extends PrefillField>(field: K, own: string | undefined): string | undefined => {
    if (own) return own;
    const v = prefill?.[field];
    if (v) ai.add(field);
    return v;
  };
  return {
    glAccountId: pick("glAccountId", c.glAccountId),
    vendorId: pick("vendorId", c.vendorId),
    taxCodeId: pick("taxCodeId", c.taxCodeId),
    payee: c.payee,
    ai,
  };
}

export type FillOutcome = "kept" | "changed" | "added" | "cleared";

/** For the audit event when an AI-filled line is posted: per box, kept or changed by the person. */
export function aiFillReport(prefill: Prefill | null, final: { glAccountId?: string; vendorId?: string; taxCodeId?: string }): Partial<Record<"gl" | "vendor" | "tax", FillOutcome>> | null {
  if (!prefill) return null;
  const out: Partial<Record<"gl" | "vendor" | "tax", FillOutcome>> = {};
  const judge = (offered: string | undefined, got: string | undefined): FillOutcome => (got === offered ? "kept" : got ? "changed" : "cleared");
  if (prefill.glAccountId) out.gl = judge(prefill.glAccountId, final.glAccountId);
  if (prefill.vendorId) out.vendor = judge(prefill.vendorId, final.vendorId);
  else if (prefill.newVendorName) out.vendor = final.vendorId ? "added" : "cleared";
  if (prefill.taxCodeId) out.tax = judge(prefill.taxCodeId, final.taxCodeId);
  return out;
}

/** A vendor name compared without case, spaces or punctuation ("Petro-Canada" = "PETRO CANADA"). */
export const vendorNameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
