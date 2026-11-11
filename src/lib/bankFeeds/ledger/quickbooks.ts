// SERVER-ONLY. Bank lines → QuickBooks Online entries:
//   money out          → Purchase (an "Expense"; on a card account, a card charge)
//   money in, bank     → Deposit
//   money in, card     → Purchase with Credit: true (a card refund)
//   matched to a bill  → BillPayment against the bill already in QuickBooks
//   transfer           → Transfer
// Every write carries requestid: QuickBooks answers a repeated requestid with
// the original response instead of creating a second entry.
import { ledgerFetch, round2 } from "./http";
import { LedgerError, type LedgerAccount, type LedgerAdapter, type LedgerContext, type LedgerEntry, type LedgerRequest, type PostedEntry, type Posting } from "./types";

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

const QB_ID = /^\d{1,20}$/;
const BILL_CHUNK = 100;

/** Pure: the queries that read these bills' open balances, 100 bills each. Ids that aren't QuickBooks ids are dropped. */
export function buildQbBillBalanceQueries(billIds: string[]): LedgerRequest[] {
  const ids = Array.from(new Set(billIds.filter((id) => QB_ID.test(id))));
  const out: LedgerRequest[] = [];
  for (let i = 0; i < ids.length; i += BILL_CHUNK) {
    const list = ids.slice(i, i + BILL_CHUNK).map((id) => `'${id}'`).join(",");
    out.push({ method: "GET", path: "/query", query: { query: `select Id, Balance from Bill where Id in (${list}) MAXRESULTS 1000` } });
  }
  return out;
}

/** Pure: the bills in a query answer with a zero balance. */
export function paidFromQbAnswer(data: Record<string, unknown>): string[] {
  const rows = ((data.QueryResponse as { Bill?: { Id?: string; Balance?: number | string }[] } | undefined)?.Bill ?? []);
  return rows.filter((b) => b.Id && b.Balance !== undefined && b.Balance !== "" && Number(b.Balance) <= 0).map((b) => String(b.Id));
}

// ------------------------------------------------- entries already in the books

/** The QuickBooks entries that move money in a bank or card account. */
export const QB_ENTRY_ENTITIES = ["Purchase", "Deposit", "Transfer", "BillPayment", "Payment"] as const;
const ENTRY_PAGE = 1000;
const ENTRY_MAX_PAGES = 10;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure: one page of one entity's entries dated from..to (inclusive). */
export function buildQbEntryQuery(entity: (typeof QB_ENTRY_ENTITIES)[number], from: string, to: string, start = 1): LedgerRequest {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new Error("Dates must be YYYY-MM-DD.");
  return { method: "GET", path: "/query", query: { query: `select * from ${entity} where TxnDate >= '${from}' and TxnDate <= '${to}' STARTPOSITION ${start} MAXRESULTS ${ENTRY_PAGE}` } };
}

type QbRef = { value?: string | number; name?: string };
interface QbEntryRow {
  Id?: string | number;
  TxnDate?: string;
  TotalAmt?: number | string;
  Amount?: number | string;
  PrivateNote?: string;
  // Purchase
  AccountRef?: QbRef;
  Credit?: boolean;
  PaymentType?: string;
  EntityRef?: QbRef;
  // Deposit, Payment
  DepositToAccountRef?: QbRef;
  Line?: { DepositLineDetail?: { Entity?: QbRef } }[];
  CustomerRef?: QbRef;
  // Transfer
  FromAccountRef?: QbRef;
  ToAccountRef?: QbRef;
  // BillPayment
  VendorRef?: QbRef;
  CheckPayment?: { BankAccountRef?: QbRef };
  CreditCardPayment?: { CCAccountRef?: QbRef };
}

const toCents = (n: unknown): number | null => {
  if ((typeof n !== "number" && typeof n !== "string") || n === "") return null;
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
};

/** Pure: the entries in one query answer, each as the money it moved in one bank or card account. */
export function entriesFromQbAnswer(entity: string, data: Record<string, unknown>, appBase: string): LedgerEntry[] {
  const rows = ((data.QueryResponse as Record<string, unknown> | undefined)?.[entity] ?? []) as QbEntryRow[];
  const out: LedgerEntry[] = [];
  for (const r of rows) {
    const id = r.Id === undefined || r.Id === null ? "" : String(r.Id);
    const date = typeof r.TxnDate === "string" ? r.TxnDate.slice(0, 10) : "";
    if (!id || !ISO_DATE.test(date)) continue;
    const add = (account: QbRef | undefined, cents: number | null, label: string, name: string | null | undefined, path: string, side?: "from" | "to") => {
      if (!account?.value || !cents) return;
      out.push({
        key: `${entity}:${id}${side ? `:${side}` : ""}`,
        entity,
        id,
        accountId: String(account.value),
        date,
        amountCents: cents,
        label,
        name: name?.trim() || null,
        url: `${appBase}/${path}?txnId=${encodeURIComponent(id)}`,
      });
    };
    const total = toCents(r.TotalAmt);
    switch (entity) {
      case "Purchase": {
        // Credit = money back onto a card (a refund); otherwise money out.
        const credit = r.Credit === true;
        const cheque = r.PaymentType === "Check";
        add(r.AccountRef, total === null ? null : credit ? total : -total, credit ? "Card credit" : cheque ? "Cheque" : "Expense", r.EntityRef?.name ?? r.PrivateNote, credit ? "creditcardcredit" : cheque ? "check" : "expense");
        break;
      }
      case "Deposit":
        add(r.DepositToAccountRef, total, "Deposit", r.Line?.find((l) => l.DepositLineDetail?.Entity?.name)?.DepositLineDetail?.Entity?.name ?? r.PrivateNote, "deposit");
        break;
      case "Payment":
        add(r.DepositToAccountRef, total, "Customer payment", r.CustomerRef?.name, "recvpayment");
        break;
      case "BillPayment":
        add(r.CheckPayment?.BankAccountRef ?? r.CreditCardPayment?.CCAccountRef, total === null ? null : -total, "Bill payment", r.VendorRef?.name, "billpayment");
        break;
      case "Transfer": {
        const amount = toCents(r.Amount);
        add(r.FromAccountRef, amount === null ? null : -amount, "Transfer", r.ToAccountRef?.name ? `To ${r.ToAccountRef.name}` : null, "transfer", "from");
        add(r.ToAccountRef, amount, "Transfer", r.FromAccountRef?.name ? `From ${r.FromAccountRef.name}` : null, "transfer", "to");
        break;
      }
    }
  }
  return out;
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

  async paidBills(ctx, billIds) {
    const answers = await Promise.all(buildQbBillBalanceQueries(billIds).map((req) => call(ctx, req)));
    return answers.flatMap(paidFromQbAnswer);
  },

  async entriesBetween(ctx, from, to) {
    const out: LedgerEntry[] = [];
    for (const entity of QB_ENTRY_ENTITIES) {
      for (let page = 0; page < ENTRY_MAX_PAGES; page++) {
        const data = await call(ctx, buildQbEntryQuery(entity, from, to, page * ENTRY_PAGE + 1));
        out.push(...entriesFromQbAnswer(entity, data, APP[envOf(ctx)]));
        const rows = ((data.QueryResponse as Record<string, unknown[]> | undefined)?.[entity] ?? []).length;
        if (rows < ENTRY_PAGE) break;
      }
    }
    return out;
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
