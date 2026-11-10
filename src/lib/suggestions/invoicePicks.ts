// Smart Suggestions, step 2, on the invoice review screen: the top 3 GL
// accounts for a bill.
//   1st: a company rule for the vendor, if there is one (a rule beats both);
//        then the vendor's default GL from the Scantrix API, as today;
//   2nd and 3rd: company memory — the accounts people chose for this vendor's
//        bills they posted themselves, and for its bank lines.
// Pure, so it can be tested without a screen.

import { historyPicks, topPicks, type Confidence, type MemoryVote, type SuggestionPick } from "./picks";

/** A bill a person posted (postedStatus "manual"), reduced to what memory needs. */
export interface PastBill {
  id: string;
  vendorId: string | null;
  vendorName: string;
  number: string;
  /** "YYYY-MM-DD", the bill's own date. */
  date: string;
  total: number | null;
  glAccountId: string | null;
  taxCodeId: string | null;
  /** When it was posted (else last changed). */
  decidedAt: string;
}

export const sameVendorName = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) !== "" && norm(a) === norm(b);
};

/** This vendor's posted bills as memory votes; the bill on screen is left out. */
export function billVotes(bills: PastBill[], vendor: { id: string | null; name: string }, excludeId?: string): MemoryVote[] {
  return bills
    .filter((b) => b.id !== excludeId && b.glAccountId)
    .filter((b) => (vendor.id && b.vendorId ? b.vendorId === vendor.id : sameVendorName(b.vendorName, vendor.name)))
    .map((b) => ({
      glAccountId: b.glAccountId as string,
      taxCodeId: b.taxCodeId,
      decidedAt: b.decidedAt,
      evidence: {
        label: b.number ? `${b.vendorName} #${b.number}` : b.vendorName,
        date: b.date || b.decidedAt.slice(0, 10),
        amountCents: typeof b.total === "number" ? Math.round(Math.abs(b.total) * 100) : null,
        source: "invoice" as const,
      },
    }));
}

export interface InvoicePickInput {
  vendorName: string;
  rule: { id: string; glAccountId: string; taxCodeId: string | null; label: string } | null;
  vendorDefault: { glAccountId: string | null; taxCodeId: string | null } | null;
  votes: MemoryVote[];
  now?: number;
}

export function invoicePicks({ vendorName, rule, vendorDefault, votes, now = Date.now() }: InvoicePickInput): SuggestionPick[] {
  const subject = vendorName.trim() || "this vendor";
  const history = historyPicks(votes, subject, now);
  const rulePick: SuggestionPick[] = rule
    ? [{ glAccountId: rule.glAccountId, ...(rule.taxCodeId ? { taxCodeId: rule.taxCodeId } : {}), confidence: "high", step: "rule", subject: rule.label, lines: 0, weight: 0, evidence: [], ruleId: rule.id }]
    : [];
  // The vendor default is as sure as the memory behind it; with none, Medium.
  const behindDefault = vendorDefault?.glAccountId ? history.find((p) => p.glAccountId === vendorDefault.glAccountId) : undefined;
  const defaultPick: SuggestionPick[] = vendorDefault?.glAccountId
    ? [
        {
          glAccountId: vendorDefault.glAccountId,
          ...(vendorDefault.taxCodeId ? { taxCodeId: vendorDefault.taxCodeId } : {}),
          confidence: (behindDefault?.confidence ?? "medium") as Confidence,
          step: "vendor_default",
          subject,
          lines: behindDefault?.lines ?? 0,
          weight: behindDefault?.weight ?? 0,
          evidence: behindDefault?.evidence ?? [],
        },
      ]
    : [];
  return topPicks(rulePick, defaultPick, history);
}
