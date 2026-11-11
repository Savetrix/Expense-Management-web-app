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
import { LedgerError, type LedgerAccount, type LedgerAdapter, type LedgerContext, type LedgerEntry, type LedgerRequest, type PostedEntry, type Posting } from "./types";

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

const XERO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BILL_CHUNK = 40;

/** Pure: the requests that read these bills (Xero "invoices" of type ACCPAY), 40 each. Ids that aren't Xero ids are dropped. */
export function buildXeroBillRequests(billIds: string[]): LedgerRequest[] {
  const ids = Array.from(new Set(billIds.filter((id) => XERO_ID.test(id))));
  const out: LedgerRequest[] = [];
  for (let i = 0; i < ids.length; i += BILL_CHUNK) out.push({ method: "GET", path: "/Invoices", query: { IDs: ids.slice(i, i + BILL_CHUNK).join(",") } });
  return out;
}

/** Pure: the bills in an answer that can't be paid any more: paid in full, voided or deleted. */
export function paidFromXeroAnswer(data: Record<string, unknown>): string[] {
  const rows = (data.Invoices ?? []) as { InvoiceID?: string; Status?: string; AmountDue?: number }[];
  return rows
    .filter((b) => b.InvoiceID && (b.Status === "PAID" || b.Status === "VOIDED" || b.Status === "DELETED" || (b.Status === "AUTHORISED" && typeof b.AmountDue === "number" && b.AmountDue <= 0)))
    .map((b) => b.InvoiceID as string);
}

// ------------------------------------------------- entries already in the books

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_PAGE = 100;
const ENTRY_MAX_PAGES = 20;

/** Xero's filter date: DateTime(2026,11,4). */
const xeroDateTime = (iso: string) => `DateTime(${iso.slice(0, 4)},${Number(iso.slice(5, 7))},${Number(iso.slice(8, 10))})`;

/** Pure: the filter for entries dated from..to (inclusive). */
export function xeroEntryWhere(from: string, to: string): string {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new Error("Dates must be YYYY-MM-DD.");
  return `Date >= ${xeroDateTime(from)} && Date <= ${xeroDateTime(to)}`;
}

/** Pure: one page of spend/receive money, of payments, or all bank transfers, dated from..to. */
export function buildXeroEntryRequest(collection: "BankTransactions" | "Payments" | "BankTransfers", from: string, to: string, page = 1): LedgerRequest {
  const where = xeroEntryWhere(from, to);
  return { method: "GET", path: `/${collection}`, query: collection === "BankTransfers" ? { where } : { where, page: String(page) } };
}

/** A Xero JSON date: DateString "2026-11-04T00:00:00", or "/Date(1762214400000+0000)/". */
export function xeroDay(dateString: unknown, date: unknown): string | null {
  if (typeof dateString === "string" && ISO_DATE.test(dateString.slice(0, 10))) return dateString.slice(0, 10);
  const ms = typeof date === "string" ? /\/Date\((-?\d+)/.exec(date)?.[1] : undefined;
  if (ms) return new Date(Number(ms)).toISOString().slice(0, 10);
  if (typeof date === "string" && ISO_DATE.test(date.slice(0, 10))) return date.slice(0, 10);
  return null;
}

// Payment types where the money leaves the bank account (paying a bill, refunding a customer).
const PAYMENT_OUT = new Set(["ACCPAYPAYMENT", "ARCREDITPAYMENT", "AROVERPAYMENTPAYMENT", "ARPREPAYMENTPAYMENT"]);

interface XeroEntryRow {
  BankTransactionID?: string;
  BankTransferID?: string;
  PaymentID?: string;
  Type?: string;
  PaymentType?: string;
  Status?: string;
  Date?: string;
  DateString?: string;
  Total?: number;
  Amount?: number;
  Reference?: string;
  Contact?: { Name?: string };
  BankAccount?: { AccountID?: string };
  Account?: { AccountID?: string };
  Invoice?: { Contact?: { Name?: string } };
  FromBankAccount?: { AccountID?: string; Name?: string };
  ToBankAccount?: { AccountID?: string; Name?: string };
}

/** Pure: the entries in one answer, each as the money it moved in one bank or card account. */
export function entriesFromXeroAnswer(collection: string, data: Record<string, unknown>, link: (path: string) => string | null): LedgerEntry[] {
  const rows = (data[collection] ?? []) as XeroEntryRow[];
  const out: LedgerEntry[] = [];
  const cents = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) : null);
  for (const r of rows) {
    if (r.Status === "DELETED" || r.Status === "VOIDED") continue;
    const date = xeroDay(r.DateString, r.Date);
    if (!date) continue;
    const add = (entity: string, id: string | undefined, accountId: string | undefined, amount: number | null, label: string, name: string | null | undefined, url: string | null, side?: "from" | "to") => {
      if (!id || !accountId || !amount) return;
      out.push({ key: `${entity}:${id}${side ? `:${side}` : ""}`, entity, id, accountId, date, amountCents: amount, label, name: name?.trim() || null, url });
    };
    if (collection === "BankTransactions") {
      // Transfers come from BankTransfers, with both sides; skip their halves here.
      const type = r.Type ?? "";
      if (type.includes("TRANSFER")) continue;
      const total = cents(r.Total);
      const out_ = type.startsWith("SPEND");
      add("BankTransaction", r.BankTransactionID, r.BankAccount?.AccountID, total === null ? null : out_ ? -total : total, out_ ? "Spend money" : "Receive money", r.Contact?.Name ?? r.Reference, link(`/Bank/ViewTransaction.aspx?bankTransactionID=${r.BankTransactionID}`));
    } else if (collection === "Payments") {
      const amount = cents(r.Amount);
      const paidOut = PAYMENT_OUT.has(r.PaymentType ?? "");
      add("Payment", r.PaymentID, r.Account?.AccountID, amount === null ? null : paidOut ? -amount : amount, r.PaymentType === "ACCPAYPAYMENT" ? "Bill payment" : "Payment", r.Invoice?.Contact?.Name ?? r.Reference, null);
    } else if (collection === "BankTransfers") {
      const amount = cents(r.Amount);
      const url = link(`/Bank/ViewTransfer.aspx?bankTransferID=${r.BankTransferID}`);
      add("BankTransfer", r.BankTransferID, r.FromBankAccount?.AccountID, amount === null ? null : -amount, "Transfer", r.ToBankAccount?.Name ? `To ${r.ToBankAccount.Name}` : null, url, "from");
      add("BankTransfer", r.BankTransferID, r.ToBankAccount?.AccountID, amount, "Transfer", r.FromBankAccount?.Name ? `From ${r.FromBankAccount.Name}` : null, url, "to");
    }
  }
  return out;
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

  async paidBills(ctx, billIds) {
    const answers = await Promise.all(buildXeroBillRequests(billIds).map((req) => call(ctx, req)));
    return answers.flatMap(paidFromXeroAnswer);
  },

  async entriesBetween(ctx, from, to) {
    const out: LedgerEntry[] = [];
    const link = (path: string) => deepLink(ctx, path);
    for (const collection of ["BankTransactions", "Payments"] as const) {
      for (let page = 1; page <= ENTRY_MAX_PAGES; page++) {
        const data = await call(ctx, buildXeroEntryRequest(collection, from, to, page));
        out.push(...entriesFromXeroAnswer(collection, data, link));
        if (((data[collection] as unknown[] | undefined) ?? []).length < ENTRY_PAGE) break;
      }
    }
    out.push(...entriesFromXeroAnswer("BankTransfers", await call(ctx, buildXeroEntryRequest("BankTransfers", from, to)), link));
    return out;
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
