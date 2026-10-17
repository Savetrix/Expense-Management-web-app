import { ACCOUNTS } from "./mockData";
import type { AmortisationKind } from "./types";

// Labels that differ between prepayments (bills) and deferred income (sales
// invoices) — everything else about the two flows is identical.
export interface AmortisationCopy {
  title: string;
  singular: string;
  addLabel: string;
  partyLabel: string;
  sourceNoun: string;
  balanceAccountLabel: string;
  pnlAccountLabel: string;
  amountLabel: string;
  balanceAccounts: readonly string[];
  pnlAccounts: readonly string[];
  releaseHeader: string;
}

export const AMORTISATION_COPY: Record<AmortisationKind, AmortisationCopy> = {
  prepayment: {
    title: "Prepayments",
    singular: "prepayment",
    addLabel: "Add prepayment",
    partyLabel: "Vendor",
    sourceNoun: "bill",
    balanceAccountLabel: "Prepayment account",
    pnlAccountLabel: "Expense account",
    amountLabel: "Prepaid amount",
    balanceAccounts: ACCOUNTS.prepayment,
    pnlAccounts: ACCOUNTS.expense,
    releaseHeader: "Expensed",
  },
  deferred: {
    title: "Deferred income",
    singular: "deferred income item",
    addLabel: "Add deferred income",
    partyLabel: "Customer",
    sourceNoun: "sales invoice",
    balanceAccountLabel: "Deferred income account",
    pnlAccountLabel: "Income account",
    amountLabel: "Amount received in advance",
    balanceAccounts: ACCOUNTS.deferred,
    pnlAccounts: ACCOUNTS.income,
    releaseHeader: "Recognised",
  },
};
