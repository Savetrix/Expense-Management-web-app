// SERVER-ONLY. Bank lines → Xero entries:
//   money out          → BankTransaction SPEND ("Spend money")
//   money in           → BankTransaction RECEIVE ("Receive money")
//   matched to a bill  → Payment against the bill (ACCPAY invoice) already in Xero
//   transfer           → BankTransfer
// Every write carries an Idempotency-Key, so a retry never creates a second entry.
// Needs the accounting.banktransactions and accounting.payments scopes
// (Scantrix_API xero/auth.js DEFAULT_SCOPES); without them Xero answers 401
// insufficient_scope and the company has to sign in to Xero again once.
import { ledgerFetch, round2 } from "./http";
import { LedgerError, type LedgerAccount, type LedgerAdapter, type LedgerContext, type LedgerRequest, type PostedEntry, type Posting } from "./types";

/** XERO_API_BASE replaces the host in tests against a stand-in; never set in production. */
const apiBase = () => process.env.XERO_API_BASE?.trim() || "https://api.xero.com/api.xro/2.0";

/** Pure: the HTTP request for one posting. */
export function buildXeroRequest(posting: Posting, idempotencyKey: string): { collection: string; idField: string; request: LedgerRequest } {
  const headers = { "Idempotency-Key": idempotencyKey.slice(0, 128) };
  const reference = posting.memo.slice(0, 255);
  switch (posting.kind) {
    case "expense":
    case "deposit": {
      // Xero needs a contact on every spend/receive money entry.
      if (!posting.vendorId) throw new LedgerError("Xero needs a contact on every bank entry. Pick a vendor for this line first.", "definite", "validation");
      return {
        collection: "BankTransactions",
        idField: "BankTransactionID",
        request: {
          method: "PUT",
          path: "/BankTransactions",
          headers,
          body: {
            BankTransactions: [
              {
                Type: posting.kind === "expense" ? "SPEND" : "RECEIVE",
                Contact: { ContactID: posting.vendorId },
                BankAccount: { AccountID: posting.bankAccount.id },
                Date: posting.date,
                Reference: reference,
                // Bank amounts include tax: Xero splits it out from the TaxType.
                LineAmountTypes: posting.taxCodeId ? "Inclusive" : "NoTax",
                LineItems: [
                  {
                    Description: posting.memo.slice(0, 4000) || "Bank line",
                    Quantity: 1,
                    UnitAmount: round2(posting.amount),
                    AccountID: posting.glAccountId,
                    ...(posting.taxCodeId && { TaxType: posting.taxCodeId }),
                  },
                ],
              },
            ],
          },
        },
      };
    }
    case "billPayment":
      return {
        collection: "Payments",
        idField: "PaymentID",
        request: {
          method: "PUT",
          path: "/Payments",
          headers,
          body: { Payments: [{ Invoice: { InvoiceID: posting.billId }, Account: { AccountID: posting.bankAccount.id }, Date: posting.date, Amount: round2(posting.amount), Reference: reference }] },
        },
      };
    case "transfer":
      return {
        collection: "BankTransfers",
        idField: "BankTransferID",
        request: {
          method: "PUT",
          path: "/BankTransfers",
          headers,
          body: { BankTransfers: [{ FromBankAccount: { AccountID: posting.fromAccountId }, ToBankAccount: { AccountID: posting.toAccountId }, Amount: round2(posting.amount), Date: posting.date }] },
        },
      };
  }
}

function xeroError(status: number, headers: Headers, data: unknown): LedgerError {
  const d = data as { Elements?: { ValidationErrors?: { Message?: string }[] }[]; Message?: string; Detail?: string; Title?: string } | null;
  const validation = [...new Set((d?.Elements ?? []).flatMap((e) => e.ValidationErrors ?? []).map((v) => v.Message).filter(Boolean))].join("; ");
  const detail = validation || d?.Message || d?.Detail || d?.Title || "";
  if (status === 401 || status === 403) {
    const scope = /insufficient_scope/i.test(`${headers.get("www-authenticate") ?? ""} ${JSON.stringify(data ?? "")}`);
    if (scope) return new LedgerError("Xero hasn't allowed Scantrix to post bank entries yet. Reconnect Xero once to allow it.", "definite", "scope");
    if (status === 401) return new LedgerError("Xero didn't accept the sign-in. Try again; if it keeps failing, reconnect Xero.", "definite", "reconnect");
    return new LedgerError(detail || "Xero refused this for this organisation.", "definite", "permission");
  }
  if (status === 429) return new LedgerError("Xero is busy. Try again in a minute.", "definite", "rate_limit");
  if (status >= 500) return new LedgerError(detail || `Xero had a problem (${status}). Try again.`, "unknown", "unavailable");
  return new LedgerError(detail || `Xero refused the entry (${status}).`, "definite", "validation");
}

async function call(ctx: LedgerContext, req: LedgerRequest) {
  const qs = req.query ? `?${new URLSearchParams(req.query)}` : "";
  const res = await ledgerFetch(`${apiBase()}${req.path}${qs}`, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      "xero-tenant-id": ctx.tenantId,
      Accept: "application/json",
      ...(req.body ? { "Content-Type": "application/json" } : {}),
      ...(req.headers ?? {}),
    },
    ...(req.body ? { body: JSON.stringify(req.body) } : {}),
  });
  if (res.status < 200 || res.status >= 300) throw xeroError(res.status, res.headers, res.data);
  return res.data as Record<string, unknown>;
}

function kindOf(a: { Type?: string; BankAccountType?: string }): LedgerAccount["kind"] {
  if (a.Type === "BANK") return a.BankAccountType === "CREDITCARD" ? "card" : "bank";
  if (a.Type === "REVENUE" || a.Type === "SALES" || a.Type === "OTHERINCOME") return "income";
  if (a.Type === "EXPENSE" || a.Type === "DIRECTCOSTS" || a.Type === "OVERHEADS" || a.Type === "DEPRECIATN") return "expense";
  return "other";
}

/** Xero's documented deep links; the shortCode form opens the right organisation. */
function deepLink(ctx: LedgerContext, path: string | null): string | null {
  if (!path) return null;
  return ctx.shortCode ? `https://go.xero.com/organisationlogin/default.aspx?shortcode=${ctx.shortCode}&redirecturl=${path}` : `https://go.xero.com${path}`;
}

export const xero: LedgerAdapter = {
  async listAccounts(ctx) {
    const data = await call(ctx, { method: "GET", path: "/Accounts" });
    const rows = (data.Accounts ?? []) as { AccountID: string; Name: string; Code?: string; Type?: string; BankAccountType?: string; Status?: string; CurrencyCode?: string }[];
    return rows
      .filter((a) => a.Status !== "ARCHIVED" && a.Status !== "DELETED")
      .map((a) => ({ id: a.AccountID, name: a.Code ? `${a.Code} ${a.Name}` : a.Name, kind: kindOf(a), type: a.Type ?? "", currency: a.CurrencyCode ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async post(ctx, posting, idempotencyKey): Promise<PostedEntry> {
    const { collection, idField, request } = buildXeroRequest(posting, idempotencyKey);
    const data = await call(ctx, request);
    const id = ((data[collection] as Record<string, unknown>[] | undefined)?.[0]?.[idField] ?? null) as string | null;
    if (!id) throw new LedgerError("Xero answered without an id for the new entry.", "unknown", "unavailable");
    const path =
      collection === "BankTransactions"
        ? `/Bank/ViewTransaction.aspx?bankTransactionID=${id}`
        : collection === "BankTransfers"
          ? `/Bank/ViewTransfer.aspx?bankTransferID=${id}`
          : null;
    return { externalId: id, url: deepLink(ctx, path) };
  },
};
