// Smart Suggestions: who a line or invoice was paid to, and the company's
// Auto-classification setting. Plain functions with no server or browser calls,
// shared by the server (lib/bankFeeds/suggest.ts) and the screens.

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

/** The company's Auto-classification setting. "fill" = fill in when sure (the default). */
export type AutoClassification = "off" | "suggest" | "fill";
export const AUTO_CLASSIFICATION_MODES: AutoClassification[] = ["off", "suggest", "fill"];
