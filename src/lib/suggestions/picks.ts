// Smart Suggestions, step 2: the top 3 accounts for an item, from a company
// rule and from what the company decided before for the same vendor or payee.
// Pure and shared: the server uses it for bank lines (lib/bankFeeds/suggest.ts),
// the invoice screen uses it in the browser.
//
// Confidence comes from the evidence only:
//   High   — a company rule, or ≥ 3.0 of agreeing weight that is ≥ 90% of all
//            weight for this vendor or payee (the weight rule below).
//   Medium — the account has at least 60% of the weight.
//   Low    — anything weaker. Shown in red.
// Only High is ever filled in; Medium and Low are shown, never filled.

export type Confidence = "high" | "medium" | "low";

const DAY = 86_400_000;
export const MIN_AGREEING_WEIGHT = 3.0;
export const MIN_AGREEMENT = 0.9;
export const MEDIUM_SHARE = 0.6;

/** A decision counts fully for 90 days, half up to a year, then not at all. */
export function voteWeight(decidedAt: string, now = Date.now()): number {
  const age = (now - new Date(decidedAt).getTime()) / DAY;
  if (age <= 90) return 1;
  if (age <= 365) return 0.5;
  return 0;
}

/** One past item a pick is based on, for "How Scantrix decided". */
export interface Evidence {
  /** "Petro Canada", or the bill's vendor and number. */
  label: string;
  /** "YYYY-MM-DD": the item's own date. */
  date: string;
  /** Size of the amount, in cents; null when unknown. */
  amountCents: number | null;
  /** A Scantrix bank line or bill, or a line from the company's own books (history). */
  source: "bank" | "invoice" | HistorySource;
}

export type HistorySource = "quickbooks" | "xero";
export const isHistory = (e: Pick<Evidence, "source">): e is Evidence & { source: HistorySource } => e.source === "quickbooks" || e.source === "xero";
export const HISTORY_LABEL: Record<HistorySource, string> = { quickbooks: "QuickBooks", xero: "Xero" };

/** One decision a person made: the account (and tax code) an item went to. */
export interface MemoryVote {
  glAccountId: string;
  taxCodeId: string | null;
  decidedAt: string;
  evidence: Evidence;
}

export type PickStep = "rule" | "history" | "vendor_default";

export interface SuggestionPick {
  glAccountId: string;
  taxCodeId?: string;
  confidence: Confidence;
  step: PickStep;
  /** Who the history is about ("Petro Canada"), or the rule's subject. */
  subject: string;
  /** How many past items chose this account (history only). */
  lines: number;
  /** Of those, how many came from the company's QuickBooks/Xero books, and from which. */
  historyLines?: number;
  historySource?: HistorySource;
  /** Their weight (recent count 1, older ½). */
  weight: number;
  /** The most recent past items behind it, newest first (at most 3). */
  evidence: Evidence[];
  ruleId?: string;
}

export const MAX_PICKS = 3;
const MAX_EVIDENCE = 3;

/**
 * The accounts this vendor's or payee's past decisions went to, strongest
 * first, one pick per account. The tax code is the one most used with that
 * account. Votes older than a year carry no weight and are left out.
 */
export function historyPicks(votes: MemoryVote[], subject: string, now = Date.now()): SuggestionPick[] {
  const groups = new Map<string, { weight: number; lines: number; tax: Map<string, number>; votes: MemoryVote[] }>();
  let total = 0;
  for (const v of votes) {
    const w = voteWeight(v.decidedAt, now);
    if (w <= 0 || !v.glAccountId) continue;
    total += w;
    const g = groups.get(v.glAccountId) ?? { weight: 0, lines: 0, tax: new Map<string, number>(), votes: [] as MemoryVote[] };
    g.weight += w;
    g.lines += 1;
    const t = v.taxCodeId ?? "";
    g.tax.set(t, (g.tax.get(t) ?? 0) + w);
    g.votes.push(v);
    groups.set(v.glAccountId, g);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].weight - a[1].weight || b[1].lines - a[1].lines)
    .map(([glAccountId, g]) => {
      const tax = [...g.tax.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      const share = total > 0 ? g.weight / total : 0;
      const confidence: Confidence = g.weight >= MIN_AGREEING_WEIGHT && share >= MIN_AGREEMENT ? "high" : share >= MEDIUM_SHARE ? "medium" : "low";
      const evidence = [...g.votes].sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1)).slice(0, MAX_EVIDENCE).map((v) => v.evidence);
      const fromBooks = g.votes.filter((v) => isHistory(v.evidence));
      const history = fromBooks.length ? { historyLines: fromBooks.length, historySource: fromBooks[0].evidence.source as HistorySource } : {};
      return { glAccountId, ...(tax ? { taxCodeId: tax } : {}), confidence, step: "history" as const, subject, lines: g.lines, weight: g.weight, evidence, ...history };
    });
}

/** Up to 3 picks, the first of each account kept: earlier lists win. */
export function topPicks(...lists: SuggestionPick[][]): SuggestionPick[] {
  const seen = new Set<string>();
  const out: SuggestionPick[] = [];
  for (const list of lists) {
    for (const p of list) {
      if (seen.has(p.glAccountId)) continue;
      seen.add(p.glAccountId);
      out.push(p);
      if (out.length === MAX_PICKS) return out;
    }
  }
  return out;
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-12" → "12 Oct". */
export const shortDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : iso);

/**
 * The reason shown next to a pick: "You coded Petro Canada to Travel 4 times",
 * or, when the company's own books are behind it, "From your QuickBooks
 * history: Petro Canada, 12 Oct".
 */
export function pickReason(pick: Pick<SuggestionPick, "step" | "subject" | "lines"> & Partial<Pick<SuggestionPick, "historyLines" | "historySource" | "evidence">>, accountName: string): string {
  if (pick.step === "rule") return `Your company rule for ${pick.subject}`;
  if (pick.step === "vendor_default") return pick.lines > 0 ? `Vendor default for ${pick.subject}, used ${times(pick.lines)} before` : `Vendor default for ${pick.subject}`;
  const fromBooks = pick.historyLines ?? 0;
  if (fromBooks > 0 && pick.historySource) {
    const books = HISTORY_LABEL[pick.historySource];
    if (fromBooks >= pick.lines) {
      const latest = pick.evidence?.find(isHistory);
      const more = pick.lines > 1 ? ` (${times(pick.lines)} in all)` : "";
      return latest ? `From your ${books} history: ${latest.label}, ${shortDate(latest.date)}${more}` : `From your ${books} history: ${pick.subject}${more}`;
    }
    return `You coded ${pick.subject} to ${accountName} ${times(pick.lines - fromBooks)}, and ${times(fromBooks)} in ${books}`;
  }
  return `You coded ${pick.subject} to ${accountName} ${times(pick.lines)}`;
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low" };
