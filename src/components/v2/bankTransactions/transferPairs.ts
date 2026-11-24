// Suggested transfers (Saurabh, 24 Nov): money leaves one of the company's
// accounts and the same amount lands in another. A pair is suggested only when:
//   - both lines are still to review and both accounts are mapped to an
//     account in QuickBooks/Xero (different ones);
//   - out and in are the same amount to the cent, in the same known currency;
//   - the dates are at most 3 days apart;
//   - each line has exactly one such partner;
//   - a person hasn't said "Not this" to the pair before.
// Anything else is left for the person. Posting a pair sends one transfer
// entry, and the other line is marked by the same entry (posting.ts).
import type { BankTransaction } from "./types";

export const TRANSFER_MAX_DAYS = 3;
const DAY_MS = 86_400_000;

export interface TransferPair {
  out: BankTransaction;
  in: BankTransaction;
}

export interface PairContext {
  /** The QuickBooks/Xero account the line's bank account maps to, or null when it isn't mapped. */
  ledgerIdOf: (t: BankTransaction) => string | null | undefined;
  currencyOf: (t: BankTransaction) => string | null | undefined;
}

const cents = (n: number) => Math.round(Math.abs(n) * 100);
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
const refused = (a: BankTransaction, b: BankTransaction) => Boolean(a.notTransferWith?.includes(b.id) || b.notTransferWith?.includes(a.id));

export function findTransferPairs(txns: readonly BankTransaction[], ctx: PairContext): TransferPair[] {
  const open = txns.filter((t) => t.status === "review" && !t.postingStatus && t.amount !== 0 && ctx.ledgerIdOf(t) && ctx.currencyOf(t));
  const fits = (o: BankTransaction, i: BankTransaction) =>
    o.amount < 0 &&
    i.amount > 0 &&
    cents(o.amount) === cents(i.amount) &&
    o.accountName !== i.accountName &&
    ctx.ledgerIdOf(o) !== ctx.ledgerIdOf(i) &&
    String(ctx.currencyOf(o)).toUpperCase() === String(ctx.currencyOf(i)).toUpperCase() &&
    daysApart(o.date, i.date) <= TRANSFER_MAX_DAYS &&
    !refused(o, i);
  const outs = open.filter((t) => t.amount < 0);
  const ins = open.filter((t) => t.amount > 0);
  const pairs: TransferPair[] = [];
  for (const o of outs) {
    const partners = ins.filter((i) => fits(o, i));
    if (partners.length !== 1) continue;
    const [i] = partners;
    if (outs.filter((x) => fits(x, i)).length !== 1) continue;
    pairs.push({ out: o, in: i });
  }
  return pairs;
}

/** What each line saves when its pair is posted: a transfer pointing at the other line's account. */
export function pairPatches(pair: TransferPair): { id: string; patch: Partial<BankTransaction> }[] {
  const side = (t: BankTransaction, other: BankTransaction) => ({
    id: t.id,
    patch: { status: "transfer" as const, transferAccount: other.accountName, ...(other.accountId ? { transferAccountId: other.accountId } : {}), matchedInvoiceId: undefined },
  });
  return [side(pair.out, pair.in), side(pair.in, pair.out)];
}
