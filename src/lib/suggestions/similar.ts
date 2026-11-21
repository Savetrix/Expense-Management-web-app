// Smart Suggestions, step 3: similar past items. When a vendor or payee is new
// (step 2 has nothing for it), ScanTrix finds past items from ANY vendor that
// mean the same thing — "ESSO 5521" fuel looks like "Petro-Canada" fuel — and
// lets them vote, so the company's own choice wins (fuel → Travel, not some
// generic "Petrol expense"). Pure: text building and voting, no network.
//
// Rules (Feature 5):
//   - money out is compared only with money out, money in with money in;
//   - an item is close at a similarity of CLOSE_SIMILARITY or more (see below);
//   - the nearest 20 close items vote, but only those nearly as close as the
//     closest one (within VOTE_WINDOW); last 90 days count fully, older half;
//   - Medium: at least 3 close items, the closest one clearly alike (0.55 or
//     more), and the top account holds ≥ 60% of the vote; anything weaker is
//     Low (shown in red);
//   - never filled in.
import { historyPicks, voteWeight, type Evidence, type MemoryVote, type SuggestionPick } from "./picks";

/**
 * When a past item counts as "close". Feature 5 started from 0.80, to tune
 * after launch. Measured on 15 Nov 2026 with text-embedding-3-small (512) on
 * Feature 5's 20-item set (src/test/suggestionsSimilarLive.test.ts): short
 * bank texts that really are alike score 0.55–0.82, so 0.80 found the right
 * account for 3 of 20; 0.50 found it first for 20 of 20 (with Plaid's
 * category in the text). Server setting SUGGESTIONS_SIMILAR_MIN changes it.
 */
export const CLOSE_SIMILARITY = (() => {
  const v = typeof process !== "undefined" ? Number(process.env.SUGGESTIONS_SIMILAR_MIN) : NaN;
  return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.5;
})();
export const MAX_VOTERS = 20;
/**
 * Only items within this much of the closest one vote. Without it, many
 * loosely alike items outvote a few really alike ones: three "PETRO-CANADA
 * TORONTO" lines beat two "MCDONALDS TORONTO" lines for a new "BURGER KING
 * TORONTO", because the town made them all look a bit alike. Measured 17 Nov
 * 2026: right account first on a same-town set went from 2 of 10 to 9 of 10
 * (with shop kinds, shopKind.ts); Feature 5's set stayed 20 of 20.
 */
export const VOTE_WINDOW = 0.1;
export const MEDIUM_MIN_CLOSE = 3;
/**
 * Medium also needs the closest item to be clearly alike, not just over the
 * cut-off: on 21 Nov the sandbox's "BELL CANADA ONLINE PAYMENT" reached Medium
 * Travel from three "PETRO-CANADA" lines at 0.52 (the shared word Canada).
 * Real matches in Feature 5's set score 0.55 and up.
 */
export const MEDIUM_MIN_SIMILARITY = 0.55;
export const MEDIUM_SHARE = 0.6;

// ------------------------------------------------------------------ text

/** Card numbers cut to the last 4: "4520 1234 5678 9012" → "****9012". Never send a full card number anywhere. */
export function maskCardNumbers(text: string): string {
  return text.replace(/\b\d(?:[ -]?\d){11,18}\b/g, (m) => `****${m.replace(/\D/g, "").slice(-4)}`);
}

/** Bank text without card numbers or store / terminal numbers: "PETRO-CANADA 1234 TORONTO ON" → "PETRO-CANADA TORONTO ON". */
export function cleanText(text: string | null | undefined): string {
  if (!text) return "";
  return maskCardNumbers(text)
    .replace(/[#*]+/g, " ")
    .split(/\s+/)
    // Store, terminal and phone numbers ("1234", "800-833-6687") say nothing about what was bought.
    .filter((w) => w && !/^[\d-]*\d[\d-]*$/.test(w))
    .join(" ")
    .trim();
}

// Canadian provinces and US states as the last word of a bank line. Words that
// are also ordinary English (IN, OR, ME, OK, HI, DE) are left out.
const REGION = new Set(
  "AB BC MB NB NL NS NT NU ON PE QC SK YT AL AK AZ AR CA CO CT FL GA ID IL IA KS KY LA MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "),
);
const STORE_NUMBER = /^#?\d{1,6}$|^\d{2,4}-\d{2,4}$/;

/**
 * The bank text without the town at the end: "PETRO-CANADA 1234 TORONTO ON" →
 * "PETRO-CANADA 1234", "HOME HARDWARE #312 BRAMPTON" → "HOME HARDWARE #312".
 * Why: the town says nothing about what was bought, and on imported files it
 * made unrelated payees in one town look alike (21 Nov, sandbox: TORONTO HYDRO
 * and PUROLATOR … MISSISSAUGA ON both came out as Petro-Canada's Travel).
 */
export function withoutPlace(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length >= 3 && REGION.has(words[words.length - 1])) return words.slice(0, -2).join(" ");
  if (words.length >= 3 && STORE_NUMBER.test(words[words.length - 2]) && /^[A-Za-z][A-Za-z.'-]*$/.test(words[words.length - 1])) return words.slice(0, -1).join(" ");
  return text.trim();
}

/** Plaid's "TRANSPORTATION_GAS" → "transportation gas". */
const category = (c: string | null | undefined) => (c ? c.toLowerCase().replace(/_/g, " ") : "");
const join = (...parts: (string | null | undefined)[]) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" | ");

/** A bank line: the cleaned payee, the description without the town, and Plaid's category or the kind of business (when known). */
export function bankText(line: { payee?: string | null; description: string; category?: string | null }): string {
  const description = cleanText(withoutPlace(maskCardNumbers(line.description)));
  const payee = cleanText(line.payee);
  return join(payee && !description.toLowerCase().startsWith(payee.toLowerCase()) ? payee : "", description, category(line.category));
}

/** A line from the company's books: the vendor and the line's own words. */
export function historyText(row: { vendorName?: string | null; description?: string | null }): string {
  return join(cleanText(row.vendorName), cleanText(row.description));
}

/** An invoice: the vendor and its line descriptions. */
export function invoiceText(inv: { vendorName?: string | null; lines?: (string | null | undefined)[] }): string {
  return join(cleanText(inv.vendorName), (inv.lines ?? []).map((l) => cleanText(l)).filter(Boolean).slice(0, 5).join("; "));
}

/** A vendor name to offer for a new payee: the bank text up to its first number or code, in normal case. "PETRO-CANADA 1234 TORONTO" → "Petro-Canada". */
export function suggestedVendorName(merchantName: string | null | undefined, description: string): string {
  if (merchantName?.trim()) return merchantName.trim();
  const words: string[] = [];
  for (const w of maskCardNumbers(description).split(/\s+/)) {
    if (!w || /\d/.test(w) || /^[#*]/.test(w) || /\.(com|ca|net|org)$/i.test(w)) break;
    const clean = w.replace(/\*.*$/, "");
    if (clean) words.push(clean);
    if (w.includes("*") || words.length === 3) break;
  }
  // Each part of a hyphenated name too: "PETRO-CANADA" → "Petro-Canada".
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  return words.map((w) => w.split("-").map(cap).join("-")).join(" ");
}

// ------------------------------------------------------------------ voting

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** A past item that can vote: its vector and how it was coded. */
export interface MemoryItem {
  vector: number[];
  out: boolean;
  glAccountId: string;
  taxCodeId: string | null;
  decidedAt: string;
  evidence: Evidence;
}

/**
 * Up to 3 accounts from the closest past items (same direction, similarity ≥
 * CLOSE_SIMILARITY, nearest 20, within VOTE_WINDOW of the closest), each
 * Medium or Low by the rules above. Empty when nothing is close: that is step
 * 4's case.
 */
export function similarPicks(query: { vector: number[]; out: boolean }, memory: MemoryItem[], now = Date.now()): SuggestionPick[] {
  const close = memory
    .filter((m) => m.out === query.out && m.glAccountId)
    .map((m) => ({ m, sim: cosine(query.vector, m.vector) }))
    .filter((x) => x.sim >= CLOSE_SIMILARITY)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, MAX_VOTERS)
    .filter((x, _, all) => x.sim >= all[0].sim - VOTE_WINDOW);
  if (close.length === 0) return [];
  const votes: MemoryVote[] = close.map(({ m }) => ({ glAccountId: m.glAccountId, taxCodeId: m.taxCodeId, decidedAt: m.decidedAt, evidence: m.evidence }));
  const total = votes.reduce((s, v) => s + voteWeight(v.decidedAt, now), 0);
  return historyPicks(votes, "similar items", now)
    .slice(0, 3)
    .map((p, i) => {
      const share = total > 0 ? p.weight / total : 0;
      const medium = i === 0 && close.length >= MEDIUM_MIN_CLOSE && share >= MEDIUM_SHARE && close[0].sim >= MEDIUM_MIN_SIMILARITY;
      return { ...p, step: "similar" as const, confidence: medium ? ("medium" as const) : ("low" as const) };
    });
}
