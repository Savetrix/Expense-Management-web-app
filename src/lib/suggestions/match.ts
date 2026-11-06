// Smart Suggestions: who a line or invoice was paid to, and which company rule
// codes it. Plain functions with no server or browser calls, so the server
// (lib/bankFeeds/suggest.ts) and the invoice review screen match a rule the
// same way.

export type RuleMatch = "payee" | "description" | "category";

const NOISE = new Set([
  "pos", "debit", "credit", "card", "purchase", "ach", "web", "online", "payment", "pmt", "recurring", "checkcard",
  "visa", "mastercard", "mc", "inc", "llc", "ltd", "co", "the", "www", "com", "help", "trip", "sq", "tst", "paypal",
  "ppd", "id", "ref", "des", "indn", "ccd", "txn", "transaction", "withdrawal", "deposit", "transfer", "xfer", "to", "from",
]);

/**
 * Who a line was paid to, reduced to a stable key: "UBER *TRIP HELP.UBER.COM"
 * and "Uber 063015 SF**POOL**" both become "uber". Plaid's cleaned-up merchant
 * name wins when there is one; otherwise digits, card masks, punctuation and
 * banking filler words are removed from the description.
 */
export function payeeKey(merchantName: string | null | undefined, description: string): string {
  const source = merchantName?.trim() ? merchantName : description;
  const words = source
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.has(w));
  // "UBER … HELP.UBER.COM" names the payee twice.
  return [...new Set(words)].slice(0, 3).join(" ");
}

/** "ESSO #12, Toronto" → "esso 12 toronto": how description words are compared. */
export function normaliseWords(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** What matching needs from a rule; `updatedAt` is a Date on the server, an ISO string in the browser. */
export interface MatchableRule {
  match: RuleMatch;
  value: string;
  updatedAt: Date | string;
}

export interface RuleLineFacts {
  payeeKey: string | null;
  description: string;
  categoryPrimary: string | null;
  categoryDetailed: string | null;
}

const time = (d: Date | string) => new Date(d).getTime();

/**
 * The rule that codes this line, or null. A payee rule matches the payee key
 * word by word from the start ("esso" matches "esso toronto on"). A vendor or
 * payee rule beats a description or category rule; among rules of the same
 * kind, the newest wins.
 */
export function ruleFor<R extends MatchableRule>(rules: R[], line: RuleLineFacts): R | null {
  const key = line.payeeKey ?? "";
  const text = ` ${normaliseWords(line.description)} `;
  const hits = rules.filter((r) =>
    r.match === "payee"
      ? Boolean(r.value) && (key === r.value || key.startsWith(`${r.value} `))
      : r.match === "description"
        ? Boolean(r.value) && text.includes(` ${r.value} `)
        : r.value === line.categoryDetailed || r.value === line.categoryPrimary,
  );
  hits.sort((a, b) => Number(b.match === "payee") - Number(a.match === "payee") || time(b.updatedAt) - time(a.updatedAt));
  return hits[0] ?? null;
}

/**
 * The vendor rule for an invoice. Invoices have no bank description or Plaid
 * category, so only vendor or payee rules apply.
 */
export function ruleForVendor<R extends MatchableRule>(rules: R[], vendorName: string): R | null {
  const key = payeeKey(null, vendorName);
  if (!key) return null;
  return ruleFor(
    rules.filter((r) => r.match === "payee"),
    { payeeKey: key, description: "", categoryPrimary: null, categoryDetailed: null },
  );
}

/** "Esso", "descriptions with “fuel”", "Plaid's category GAS_STATIONS". */
export function ruleSubject(r: { match: RuleMatch; label: string }): string {
  return r.match === "payee" ? r.label : r.match === "description" ? `descriptions with “${r.label}”` : `Plaid's category ${r.label}`;
}

/** The company's Auto-classification setting. "fill" = fill in when sure (the default). */
export type AutoClassification = "off" | "suggest" | "fill";
export const AUTO_CLASSIFICATION_MODES: AutoClassification[] = ["off", "suggest", "fill"];
