// Plaid transaction → bank_transactions row (the Plaid-fact columns only).
//
// Two conversions happen here and nowhere else:
//   * sign: Plaid reports money OUT as a positive amount; Scantrix stores money
//     out as negative (the screens' convention, types.ts: "Negative = money out").
//   * money: integer cents, rounded once.
import type { Transaction } from "plaid";

export interface PlaidFacts {
  plaidTransactionId: string;
  plaidAccountId: string;
  date: string;
  authorizedDate: string | null;
  description: string;
  merchantName: string | null;
  merchantEntityId: string | null;
  counterpartyName: string | null;
  counterpartyType: string | null;
  logoUrl: string | null;
  website: string | null;
  amountCents: number;
  currency: string | null;
  categoryPrimary: string | null;
  categoryDetailed: string | null;
  categoryConfidence: string | null;
  paymentChannel: string | null;
  checkNumber: string | null;
}

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** The most useful counterparty: the merchant Plaid is most sure of, else the first one. */
function primaryCounterparty(t: Transaction): { name: string; type: string | null } | null {
  const list = t.counterparties ?? [];
  if (list.length === 0) return null;
  const rank = (c: (typeof list)[number]) => (c.confidence_level === "VERY_HIGH" ? 3 : c.confidence_level === "HIGH" ? 2 : c.confidence_level === "MEDIUM" ? 1 : 0);
  const best = [...list].sort((a, b) => rank(b) - rank(a))[0];
  return best?.name ? { name: best.name, type: best.type ?? null } : null;
}

export function mapPlaidTransaction(t: Transaction): PlaidFacts {
  const counterparty = primaryCounterparty(t);
  const description = (t.original_description || t.name || t.merchant_name || "").trim();
  return {
    plaidTransactionId: t.transaction_id,
    plaidAccountId: t.account_id,
    date: t.date,
    authorizedDate: t.authorized_date ?? null,
    description,
    merchantName: t.merchant_name ?? null,
    merchantEntityId: t.merchant_entity_id ?? null,
    counterpartyName: counterparty?.name ?? null,
    counterpartyType: counterparty?.type ?? null,
    logoUrl: t.logo_url ?? null,
    website: t.website ?? null,
    // Plaid: positive = money out. Ours: negative = money out.
    amountCents: -toCents(t.amount),
    currency: t.iso_currency_code ?? t.unofficial_currency_code ?? null,
    categoryPrimary: t.personal_finance_category?.primary ?? null,
    categoryDetailed: t.personal_finance_category?.detailed ?? null,
    categoryConfidence: t.personal_finance_category?.confidence_level ?? null,
    paymentChannel: t.payment_channel ?? null,
    checkNumber: t.check_number ?? null,
  };
}
