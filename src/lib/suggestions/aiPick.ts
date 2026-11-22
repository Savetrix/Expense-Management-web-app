// Smart Suggestions, step 4: the AI pick, the last resort. Runs only when the
// same payee (step 2) and similar past items (step 3) have nothing for an
// item, or step 3 is below the Medium bar. Pure: what is sent and how the
// answer is checked. The call itself is lib/bankFeeds/aiPick.ts.
//
// What the AI gets (Feature 5, 20 Nov brief):
//   - the item: cleaned payee, description, the bank's category, money in or
//     out, the amount; card numbers cut to the last 4 before anything is sent;
//   - the accounts it may pick from: the bank-line GL list (no Bank or Cash,
//     not the line's own account) without receivable, payable, equity and tax
//     accounts, each with id, name, type and description;
//   - up to 10 of this company's closest past items, even weak ones, each with
//     the account it went to. Never another company's.
// What comes back: up to 3 account ids, each with a one-line reason. Every id
// is checked against the allowed list; anything else is dropped. Confidence
// never comes from the AI: every step 4 pick is Low, never filled in.
import { cleanText, maskCardNumbers } from "./similar";

export const AI_TIMEOUT_MS = 8_000;
export const AI_MAX_PAST = 10;
export const AI_MAX_PICKS = 3;
/** Lines with the same payee and direction share one answer for a day. */
export const AI_REUSE_MS = 24 * 3_600_000;

/** An account in the company's chart, as companyLists.ts keeps it. */
export interface ChartLike {
  id: string;
  name: string;
  kind: string;
  type: string;
  subtype?: string | null;
  description?: string | null;
}

export interface AiAccount {
  id: string;
  name: string;
  type: string;
  description: string | null;
}

export interface AiPastItem {
  label: string;
  accountId: string;
}

export interface AiLine {
  payee: string;
  description: string;
  /** The bank's category (Plaid), or the kind of business worked out for an imported line. */
  category: string | null;
  out: boolean;
  /** Size of the amount, in the line's currency. */
  amount: number;
  currency: string | null;
}

export interface AiInput {
  line: AiLine;
  accounts: AiAccount[];
  past: AiPastItem[];
}

export interface AiRawPick {
  accountId: string;
  reason: string;
}

/**
 * Plaid's categories for money moving between the company's own accounts
 * (account transfers, savings, investments, paying its own credit card).
 * Such a line is a transfer: step 4 never picks an account for it (on the
 * sandbox a card payment got "Note Payable", a CD deposit "Uncategorised Asset").
 */
const OWN_ACCOUNT_TRANSFER = /^(TRANSFER_(IN|OUT)_(ACCOUNT_TRANSFER|SAVINGS|INVESTMENT_AND_RETIREMENT_FUNDS)|LOAN_PAYMENTS_CREDIT_CARD_PAYMENT)$/;
export const ownAccountTransfer = (category: string | null | undefined) => Boolean(category && OWN_ACCOUNT_TRANSFER.test(category.toUpperCase()));

const TAX_WORDS = /\b(gst|hst|pst|qst|vat)\b|sales tax|tax payable|tax suspense|tax receivable|tax control|income tax payable|payroll tax payable/i;

/** A tax control account (GST/HST payable, sales tax, VAT): never a line's category. */
export function isTaxAccount(a: ChartLike): boolean {
  if (a.subtype && /tax/i.test(a.subtype)) return true; // QuickBooks GlobalTaxPayable, SalesTaxPayable…
  if (a.subtype && /^gst/i.test(a.subtype)) return true; // Xero SystemAccount GST, GSTONIMPORTS
  return a.kind === "other" && TAX_WORDS.test(a.name);
}

export const isEquityAccount = (a: ChartLike) => /^equity$/i.test(a.type.trim());

/**
 * The accounts step 4 may pick: the bank-line GL list (no Bank-type account,
 * Cash included, and none a bank line is mapped to: `bankSide`) without
 * receivable, payable, equity or tax accounts.
 */
export function aiAllowedAccounts(chart: readonly ChartLike[], bankSide: ReadonlySet<string>): AiAccount[] {
  return chart
    .filter((a) => !bankSide.has(a.id) && a.kind !== "bank" && a.kind !== "payable" && a.kind !== "receivable" && !isEquityAccount(a) && !isTaxAccount(a))
    .map((a) => ({ id: a.id, name: a.name, type: a.type, description: a.description?.trim() || null }));
}

/** Changes when the allowed list changes (an account added, renamed or removed): the line is asked again. */
export function chartHash(accounts: readonly AiAccount[]): string {
  const text = [...accounts].sort((a, b) => (a.id < b.id ? -1 : 1)).map((a) => `${a.id}\t${a.name}\t${a.type}`).join("\n");
  // FNV-1a, twice with different seeds: no Node-only import, so the module stays usable in the browser.
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
    return h.toString(16).padStart(8, "0");
  };
  return `${fnv(2166136261)}${fnv(374761393)}`;
}

/** Changes when the closest past items change (a person posted a similar line): the line is asked again. */
export const basisKey = (ids: readonly string[]) => [...ids].sort().join(",");

export const AI_SYSTEM_PROMPT = [
  "You help a small business code its bank transactions to its own chart of accounts.",
  "Pick up to 3 accounts for the transaction, best first, only from the accounts given, by their id.",
  "First decide what kind of business the payee is, from its name and the bank category.",
  "Then prefer what the company itself chose for past items of that same kind of business; a past item that only shares a word is not the same kind (a gas station selling fuel is not a gas or electricity utility).",
  'For each pick give a reason of at most 8 plain words saying what the transaction looks like, starting with "looks like" (for example: "looks like a courier service"); keep names and abbreviations such as IT or GST as written. Don\'t repeat the account name.',
  "Asset and liability accounts are for buying an asset or paying a loan, not for day-to-day spending such as fuel, meals or subscriptions.",
  "If the transaction only moves money between the company's own bank, savings, investment or credit card accounts (for example paying its own credit card), return an empty list: that is a transfer, not an expense or income.",
  "If no account fits, return an empty list.",
].join(" ");

/** The message sent: only this item, this company's allowed accounts and its own past items. Card numbers cut to the last 4. */
export function aiUserMessage(input: AiInput): string {
  const line = input.line;
  return JSON.stringify({
    transaction: {
      payee: cleanText(line.payee) || null,
      description: maskCardNumbers(cleanText(line.description)),
      bank_category: line.category ? line.category.toLowerCase().replace(/_/g, " ") : null,
      direction: line.out ? "money out" : "money in",
      amount: Math.round(Math.abs(line.amount) * 100) / 100,
      currency: line.currency,
    },
    accounts: input.accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, ...(a.description ? { description: a.description.slice(0, 200) } : {}) })),
    similar_past_items: input.past.slice(0, AI_MAX_PAST).map((p) => ({ payee: maskCardNumbers(cleanText(p.label)), account_id: p.accountId })),
  });
}

/**
 * The answer's shape (structured output). With a list of a sane size the ids
 * are listed in the schema too; every id is still checked afterwards.
 */
export function aiSchema(allowedIds: readonly string[]) {
  const idSchema = allowedIds.length > 0 && allowedIds.length <= 500 ? { type: "string", enum: [...allowedIds] } : { type: "string" };
  return {
    name: "account_picks",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["picks"],
      properties: {
        picks: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: ["account_id", "reason"], properties: { account_id: idSchema, reason: { type: "string" } } },
        },
      },
    },
  };
}

/** "Looks like a courier service." → "looks like a courier service"; kept short and plain. */
export function cleanAiReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const words = raw.replace(/[\r\n]+/g, " ").replace(/[.!]+$/, "").trim().split(/\s+/).slice(0, 12);
  const text = words.join(" ");
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : "";
}

/** The AI's answer → at most 3 picks, each an allowed account, each account once. Anything else is dropped. */
export function validPicks(raw: unknown, allowedIds: ReadonlySet<string>): AiRawPick[] {
  const list = (raw as { picks?: unknown } | null)?.picks;
  if (!Array.isArray(list)) return [];
  const out: AiRawPick[] = [];
  for (const p of list) {
    const id = typeof (p as { account_id?: unknown })?.account_id === "string" ? String((p as { account_id: string }).account_id).trim() : "";
    if (!id || !allowedIds.has(id) || out.some((x) => x.accountId === id)) continue;
    out.push({ accountId: id, reason: cleanAiReason((p as { reason?: unknown }).reason) });
    if (out.length === AI_MAX_PICKS) break;
  }
  return out;
}
