// What a bank line may be coded to, and which bank account (and currency) it
// belongs to. Pure, so it can be tested without a screen.
//
// Every entry has two sides (Saurabh, 18 Nov). On a bank line one side is
// always the bank account the line came from, so the GL account a person picks
// is the OTHER side: an expense, an asset, income for money in, or Accounts
// Payable when the line pays a bill. Bank-type accounts (Cash included) never
// appear: that side is already decided.
import type { GLAccount } from "@/store/quickBooks/quickBooksSlice";
import type { LedgerAccountDto, NamedAccountDto } from "@/store/bankFeeds/bankFeedsApi";

import type { BankAccount, BankTransaction } from "./types";

export type GlKind = LedgerAccountDto["kind"];

export interface GlChoice {
  id: string;
  label: string;
  kind: GlKind;
}

/** The backend's account type ("Bank", "BANK", "Credit Card"…) as a kind. */
export function kindOfType(type: string | null | undefined): GlKind {
  const t = (type ?? "").trim().toLowerCase().replace(/[\s_]+/g, " ");
  if (t === "bank") return "bank";
  if (t === "credit card") return "card";
  if (t === "accounts payable") return "payable";
  if (t === "accounts receivable") return "receivable";
  if (t === "income" || t === "other income" || t === "revenue" || t === "sales") return "income";
  if (t === "expense" || t === "other expense" || t === "cost of goods sold" || t === "overheads" || t === "directcosts") return "expense";
  return "other";
}

/** "Vehicles:Fuel" → "Vehicles › Fuel": a sub-account reads under its parent. */
const shown = (name: string) => name.split(":").map((p) => p.trim()).join(" › ");

/**
 * The GL list for one bank line: the full chart of accounts from
 * QuickBooks/Xero (active accounts only; sub-accounts sorted under their
 * parent), without Bank-type accounts and without the account this line
 * itself belongs to. Accounts Receivable is left out too: ScanTrix doesn't
 * record customer payments, and Xero refuses it on a bank line. Money in lists
 * income accounts first.
 *
 * When this server can't read the chart (no token route), the backend's own
 * list is used, still without Bank-type accounts. It has no Accounts Payable.
 */
export function bankLineGlChoices(args: { chart: readonly LedgerAccountDto[]; backendGl: readonly GLAccount[]; lineLedgerId: string | null; moneyIn: boolean }): GlChoice[] {
  const { chart, backendGl, lineLedgerId, moneyIn } = args;
  const choices: GlChoice[] =
    chart.length > 0
      ? chart.map((a) => ({ id: a.id, label: shown(a.name), kind: a.kind }))
      : backendGl.filter((a) => !a.isDeleted).map((a) => ({ id: a.qbAccountId, label: shown(a.name), kind: kindOfType(a.accountType) }));
  const allowed = choices
    .filter((c) => c.kind !== "bank" && c.kind !== "receivable" && c.id !== lineLedgerId)
    .map((c) => (c.kind === "payable" ? { ...c, label: `${c.label} (pay a bill)` } : c))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!moneyIn) return allowed;
  return [...allowed.filter((c) => c.kind === "income"), ...allowed.filter((c) => c.kind !== "income")];
}

/** The account in QuickBooks/Xero this line's bank account is mapped to (Connected accounts), if any. */
export function lineLedgerId(txn: Pick<BankTransaction, "accountId" | "accountName">, bankAccounts: readonly BankAccount[], named: readonly NamedAccountDto[]): string | null {
  const plaid = txn.accountId ? bankAccounts.find((a) => a.id === txn.accountId) : undefined;
  if (plaid) return plaid.mappedGlAccountId ?? null;
  const label = txn.accountName?.trim().toLowerCase();
  return (label && named.find((n) => n.accountLabel.trim().toLowerCase() === label)?.mappedLedgerAccountId) || null;
}

/**
 * The currency of the bank account this line belongs to: the line's own (set
 * by the bank, or at import), else the connected account's, else the mapped
 * account's in QuickBooks/Xero, else the company's home currency.
 */
export function lineCurrency(
  txn: Pick<BankTransaction, "accountId" | "accountName" | "currency">,
  ctx: { bankAccounts: readonly BankAccount[]; named: readonly NamedAccountDto[]; chart: readonly LedgerAccountDto[]; homeCurrency: string | null | undefined },
): string | null {
  const own = txn.currency || (txn.accountId ? ctx.bankAccounts.find((a) => a.id === txn.accountId)?.currency : null);
  if (own) return own.toUpperCase();
  const ledgerId = lineLedgerId(txn, ctx.bankAccounts, ctx.named);
  const mapped = ledgerId ? ctx.chart.find((a) => a.id === ledgerId)?.currency : null;
  return (mapped || ctx.homeCurrency || null)?.toUpperCase() ?? null;
}

/** A vendor whose currency differs from the bank account's: posting would book it in the wrong currency. */
export function currencyMismatch(vendorCurrency: string | null | undefined, bankCurrency: string | null | undefined): boolean {
  return Boolean(vendorCurrency && bankCurrency && vendorCurrency.toUpperCase() !== bankCurrency.toUpperCase());
}

/**
 * What the vendor form starts with when a vendor is added from a bank line
 * (Saurabh, 18 Nov): a clean name ("Tim Hortons"), the GL account ScanTrix
 * suggests for this line, and no tax code (it becomes the vendor's saved tax
 * code, which the person chooses). The bank account's currency is only offered
 * in the list: the currency starts empty and must be picked (Saurabh, 20 Nov).
 */
export function vendorFormDefaults(args: { typed: string; suggestedName: string; glAccountId: string | null | undefined; currency: string | null }): { name: string; currency: string | undefined; glAccountId: string; taxCodeId: "" } {
  return { name: args.typed.trim() || args.suggestedName, currency: args.currency ?? undefined, glAccountId: args.glAccountId ?? "", taxCodeId: "" };
}

/** What a line saves once its new vendor exists: the vendor, and its defaults where the line has nothing yet. */
export function newVendorPatch(
  vendor: { _id: string; displayName: string; glAccountId: string | null; taxCodeId: string | null },
  shown: { glAccountId?: string | null; taxCodeId?: string | null },
): Partial<Pick<BankTransaction, "vendorId" | "payee" | "categoryId" | "taxCodeId">> {
  return {
    vendorId: vendor._id,
    payee: vendor.displayName,
    ...(vendor.glAccountId && !shown.glAccountId ? { categoryId: vendor.glAccountId } : {}),
    ...(vendor.taxCodeId && !shown.taxCodeId ? { taxCodeId: vendor.taxCodeId } : {}),
  };
}
