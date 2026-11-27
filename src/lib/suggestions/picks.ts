// Smart Suggestions, step 2: the top 3 accounts for an item, from a company
// the company's past decisions for the same vendor or payee (in ScanTrix and in
// its QuickBooks history), and from similar past items (step 3).
// Pure and shared: the server uses it for bank lines (lib/bankFeeds/suggest.ts),
// the invoice screen uses it in the browser.
//
// Confidence comes from the evidence only:
//   High   — ≥ 3.0 of agreeing weight that is ≥ 90% of all
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

/** One past item a pick is based on, for "How ScanTrix decided". */
export interface Evidence {
  /** "Petro Canada", or the bill's vendor and number. */
  label: string;
  /** "YYYY-MM-DD": the item's own date. */
  date: string;
  /** Size of the amount, in cents; null when unknown. */
  amountCents: number | null;
  /** A ScanTrix bank line or bill, or a line from the company's own books (history). */
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

/** Where a pick came from: same vendor or payee (step 2), the vendor's default, similar past items (step 3), or the AI (step 4, last resort). */
export type PickStep = "history" | "vendor_default" | "similar" | "ai";

export interface SuggestionPick {
  glAccountId: string;
  taxCodeId?: string;
  confidence: Confidence;
  step: PickStep;
  /** Who the history is about ("Petro Canada"). */
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
  /** Step 4 only: the AI's one-line reason ("looks like a courier service"). */
  aiReason?: string;
  /** Step 3 only: the tax codes of the similar posted items behind this account (prefill.ts agreedTaxCode). */
  taxVotes?: (string | null)[];
}

export const MAX_PICKS = 3;
const MAX_EVIDENCE = 3;

/**
 * The accounts this vendor's or payee's past decisions went to, strongest
 * first, one pick per account. Votes older than a year carry no weight and
 * are left out. No tax code: tax is the vendor's saved tax code, never learned
 * from past lines (Saurabh, 18 Nov); the caller adds it when the vendor has one.
 */
export function historyPicks(votes: MemoryVote[], subject: string, now = Date.now()): SuggestionPick[] {
  const groups = new Map<string, { weight: number; lines: number; votes: MemoryVote[] }>();
  let total = 0;
  for (const v of votes) {
    const w = voteWeight(v.decidedAt, now);
    if (w <= 0 || !v.glAccountId) continue;
    total += w;
    const g = groups.get(v.glAccountId) ?? { weight: 0, lines: 0, votes: [] as MemoryVote[] };
    g.weight += w;
    g.lines += 1;
    g.votes.push(v);
    groups.set(v.glAccountId, g);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].weight - a[1].weight || b[1].lines - a[1].lines)
    .map(([glAccountId, g]) => {
      const share = total > 0 ? g.weight / total : 0;
      const confidence: Confidence = g.weight >= MIN_AGREEING_WEIGHT && share >= MIN_AGREEMENT ? "high" : share >= MEDIUM_SHARE ? "medium" : "low";
      const evidence = [...g.votes].sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1)).slice(0, MAX_EVIDENCE).map((v) => v.evidence);
      const fromBooks = g.votes.filter((v) => isHistory(v.evidence));
      const history = fromBooks.length ? { historyLines: fromBooks.length, historySource: fromBooks[0].evidence.source as HistorySource } : {};
      return { glAccountId, confidence, step: "history" as const, subject, lines: g.lines, weight: g.weight, evidence, ...history };
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-12" → "12 Oct". */
export const shortDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : iso);

/**
 * Items read from the company's QuickBooks/Xero books (history.ts) are shown
 * without their date, their source or how many there were: only "From prior
 * classifications" (Saurabh, 20 Nov). Items posted in ScanTrix keep their
 * dates. Every item that isn't from the books was posted in ScanTrix.
 */
export const PRIOR = "From prior classifications";
export const isPrior = (e: Pick<Evidence, "source">) => isHistory(e);

/** "Tim Hortons 12 Nov, 14 Nov, 18 Nov": the newest items posted in ScanTrix, in date order. Prior items are never listed. */
export function datedItems(evidence: readonly Evidence[], max = 3): string {
  const byLabel = new Map<string, string[]>();
  const newest = evidence.filter((x) => !isPrior(x)).slice(0, max);
  for (const e of [...newest].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) byLabel.set(e.label, [...(byLabel.get(e.label) ?? []), shortDate(e.date)]);
  return [...byLabel].map(([label, dates]) => `${label} ${dates.join(", ")}`).join("; ");
}

/**
 * Why an account was picked, from the items behind it:
 *   "3 earlier posts went to Meals: Tim Hortons 12 Nov, 14 Nov, 18 Nov"
 *   "2 similar posts went to Meals: Tim Hortons 12 Nov; Second Cup 3 Nov. Also from prior classifications"
 *   "From prior classifications" (only items from the books)
 * `posted` and `prior` count the items behind it posted in ScanTrix and read
 * from the books; the second count is never shown.
 */
export function postsReason(a: { kind: "earlier" | "similar"; posted: number; prior: number; account: string; evidence: readonly Evidence[] }): string {
  const items = datedItems(a.evidence);
  const own = a.posted > 0 ? `${a.posted} ${a.kind} post${a.posted === 1 ? "" : "s"} went to ${a.account}${items ? `: ${items}` : ""}` : "";
  if (a.prior <= 0) return own || `Went to ${a.account} before`;
  if (own) return `${own}. Also ${PRIOR.charAt(0).toLowerCase()}${PRIOR.slice(1)}`;
  if (a.kind === "earlier") return PRIOR;
  const names = [...new Set(a.evidence.map((e) => e.label))].slice(0, 3).join(", ");
  return `${PRIOR}: similar items${names ? ` like ${names}` : ""} went to ${a.account}`;
}

/**
 * The reason shown next to a pick: "3 earlier posts went to Travel: Petro
 * Canada 12 Oct, 3 Sep, 27 Aug", "From prior classifications", or for step 4
 * the AI's own one-line reason.
 */
export function pickReason(pick: Pick<SuggestionPick, "step" | "subject" | "lines"> & Partial<Pick<SuggestionPick, "historyLines" | "historySource" | "evidence" | "aiReason">>, accountName: string): string {
  const prior = Math.min(pick.historyLines ?? 0, pick.lines);
  const posted = pick.lines - prior;
  const evidence = pick.evidence ?? [];
  if (pick.step === "ai") return `AI pick: ${pick.aiReason?.trim() || "looks like this kind of spend"} → ${accountName}`;
  if (pick.step === "similar") return postsReason({ kind: "similar", posted, prior, account: accountName, evidence });
  if (pick.step === "vendor_default") {
    if (posted > 0) return `Vendor default for ${pick.subject}, posted there ${posted === 1 ? "once" : posted === 2 ? "twice" : `${posted} times`} before`;
    return prior > 0 ? `Vendor default for ${pick.subject}. ${PRIOR}` : `Vendor default for ${pick.subject}`;
  }
  return postsReason({ kind: "earlier", posted, prior, account: accountName, evidence });
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low" };
