// SERVER-ONLY. Bank lines → QuickBooks Online entries:
//   money out          → Purchase (an "Expense"; on a card account, a card charge)
//   money in, bank     → Deposit
//   money in, card     → Purchase with Credit: true (a card refund)
//   matched to a bill  → BillPayment against the bill already in QuickBooks
//   transfer           → Transfer
// Every write carries requestid: QuickBooks answers a repeated requestid with
// the original response instead of creating a second entry.
import { ledgerFetch, round2 } from "./http";
import { LedgerError, type LedgerAccount, type LedgerAdapter, type LedgerContext, type LedgerRequest, type PostedEntry, type Posting } from "./types";

const API = { sandbox: "https://sandbox-quickbooks.api.intuit.com", production: "https://quickbooks.api.intuit.com" };
const APP = { sandbox: "https://app.sandbox.qbo.intuit.com/app", production: "https://app.qbo.intuit.com/app" };
const MINOR_VERSION = "75";

const envOf = (ctx: LedgerContext) => (ctx.environment === "production" ? "production" : "sandbox");
/** QBO_API_BASE replaces the host in tests against a stand-in; never set in production. */
const apiBase = (ctx: LedgerContext) => process.env.QBO_API_BASE?.trim() || API[envOf(ctx)];

/** Amount and tax for one line from the bank's gross amount. */
function lineAmounts(gross: number, taxCodeId: string | null, taxRate: number | null) {
  if (!taxCodeId) return { amount: round2(gross), tax: null };
  const rate = taxRate && taxRate > 0 ? taxRate : 0;
  // Bank amounts include tax. QuickBooks wants the net Amount plus the
  // tax-inclusive total when GlobalTaxCalculation is TaxInclusive.
  return { amount: round2(gross / (1 + rate / 100)), tax: { TaxCodeRef: { value: taxCodeId }, TaxInclusiveAmt: round2(gross) } };
}

/** Pure: the HTTP request for one posting. */
export function buildQbRequest(posting: Posting, idempotencyKey: string): { entity: string; request: LedgerRequest } {
  const query = { requestid: idempotencyKey.slice(0, 50) };
  const note = posting.memo.slice(0, 4000);
  switch (posting.kind) {
    case "expense":
    case "deposit": {
      const { amount, tax } = lineAmounts(posting.amount, posting.taxCodeId, posting.taxRate);
      const taxMode = tax ? { GlobalTaxCalculation: "TaxInclusive" } : {};
      const refund = posting.kind === "deposit" && posting.bankAccount.isCard;
      if (posting.kind === "expense" || refund) {
        return {
          entity: "Purchase",
          request: {
            method: "POST",
            path: "/purchase",
            query,
            body: {
              PaymentType: posting.bankAccount.isCard ? "CreditCard" : "Cash",
              AccountRef: { value: posting.bankAccount.id },
              ...(refund && { Credit: true }),
              ...(posting.vendorId && { EntityRef: { value: posting.vendorId, type: "Vendor" } }),
              TxnDate: posting.date,
              PrivateNote: note,
              ...taxMode,
              Line: [
                {
                  DetailType: "AccountBasedExpenseLineDetail",
                  Amount: amount,
                  Description: note.slice(0, 4000),
                  AccountBasedExpenseLineDetail: { AccountRef: { value: posting.glAccountId }, ...(tax ?? {}) },
                },
              ],
            },
          },
        };
      }
      return {
        entity: "Deposit",
        request: {
          method: "POST",
          path: "/deposit",
          query,
          body: {
            DepositToAccountRef: { value: posting.bankAccount.id },
            TxnDate: posting.date,
            PrivateNote: note,
            ...taxMode,
            Line: [
              {
                DetailType: "DepositLineDetail",
                Amount: amount,
                Description: note.slice(0, 4000),
                DepositLineDetail: {
                  AccountRef: { value: posting.glAccountId },
                  ...(posting.vendorId && { Entity: { value: posting.vendorId, type: "Vendor" } }),
                  ...(tax ? { TaxCodeRef: tax.TaxCodeRef } : {}),
                },
              },
            ],
          },
        },
      };
    }
    case "billPayment": {
      const amount = round2(posting.amount);
      return {
        entity: "BillPayment",
        request: {
          method: "POST",
          path: "/billpayment",
          query,
          body: {
            VendorRef: { value: posting.vendorId },
            TotalAmt: amount,
            TxnDate: posting.date,
            PrivateNote: note,
            ...(posting.bankAccount.isCard
              ? { PayType: "CreditCard", CreditCardPayment: { CCAccountRef: { value: posting.bankAccount.id } } }
              : { PayType: "Check", CheckPayment: { BankAccountRef: { value: posting.bankAccount.id } } }),
            Line: [{ Amount: amount, LinkedTxn: [{ TxnId: posting.billId, TxnType: "Bill" }] }],
          },
        },
      };
    }
    case "transfer":
      return {
        entity: "Transfer",
        request: {
          method: "POST",
          path: "/transfer",
          query,
          body: { FromAccountRef: { value: posting.fromAccountId }, ToAccountRef: { value: posting.toAccountId }, Amount: round2(posting.amount), TxnDate: posting.date, PrivateNote: note },
        },
      };
  }
}

const APP_PATH: Record<string, string> = { Purchase: "expense", Deposit: "deposit", BillPayment: "billpayment", Transfer: "transfer" };

function qbError(status: number, data: unknown): LedgerError {
  const fault = (data as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } } | null)?.Fault?.Error?.[0];
  const detail = fault ? `${fault.Message ?? ""}${fault.Detail ? ` — ${fault.Detail}` : ""}`.trim() : "";
  if (status === 401) return new LedgerError("QuickBooks didn't accept the sign-in. Try again; if it keeps failing, reconnect QuickBooks.", "definite", "reconnect");
  if (status === 403) return new LedgerError(detail || "QuickBooks refused this for this company.", "definite", "permission");
  if (status === 429) return new LedgerError("QuickBooks is busy. Try again in a minute.", "definite", "rate_limit");
  if (status >= 500) return new LedgerError(detail || `QuickBooks had a problem (${status}). Try again.`, "unknown", "unavailable");
  return new LedgerError(detail || `QuickBooks refused the entry (${status}).`, "definite", "validation");
}

async function call(ctx: LedgerContext, req: LedgerRequest) {
  const params = new URLSearchParams({ minorversion: MINOR_VERSION, ...(req.query ?? {}) });
  const url = `${apiBase(ctx)}/v3/company/${encodeURIComponent(ctx.tenantId)}${req.path}?${params}`;
  const res = await ledgerFetch(url, {
    method: req.method,
    headers: { Authorization: `Bearer ${ctx.accessToken}`, Accept: "application/json", ...(req.body ? { "Content-Type": "application/json" } : {}) },
    ...(req.body ? { body: JSON.stringify(req.body) } : {}),
  });
  if (res.status < 200 || res.status >= 300) throw qbError(res.status, res.data);
  return res.data as Record<string, unknown>;
}

function kindOf(type: string): LedgerAccount["kind"] {
  if (type === "Bank") return "bank";
  if (type === "Credit Card") return "card";
  if (type === "Income" || type === "Other Income") return "income";
  if (type === "Expense" || type === "Other Expense" || type === "Cost of Goods Sold") return "expense";
  return "other";
}

export const quickbooks: LedgerAdapter = {
  async listAccounts(ctx) {
    const out: LedgerAccount[] = [];
    for (let start = 1; ; start += 1000) {
      const data = await call(ctx, { method: "GET", path: "/query", query: { query: `select * from Account where Active = true STARTPOSITION ${start} MAXRESULTS 1000` } });
      const rows = ((data.QueryResponse as { Account?: Record<string, unknown>[] } | undefined)?.Account ?? []) as {
        Id: string;
        Name: string;
        FullyQualifiedName?: string;
        AccountType: string;
        CurrencyRef?: { value?: string };
      }[];
      for (const a of rows) out.push({ id: String(a.Id), name: a.FullyQualifiedName || a.Name, kind: kindOf(a.AccountType), type: a.AccountType, currency: a.CurrencyRef?.value ?? null });
      if (rows.length < 1000) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },

  async post(ctx, posting, idempotencyKey): Promise<PostedEntry> {
    const { entity, request } = buildQbRequest(posting, idempotencyKey);
    const data = await call(ctx, request);
    const id = (data[entity] as { Id?: string } | undefined)?.Id;
    if (!id) throw new LedgerError("QuickBooks answered without an id for the new entry.", "unknown", "unavailable");
    const path = entity === "Purchase" && posting.kind === "deposit" ? "creditcardcredit" : APP_PATH[entity];
    return { externalId: String(id), url: `${APP[envOf(ctx)]}/${path}?txnId=${encodeURIComponent(String(id))}` };
  },
};
