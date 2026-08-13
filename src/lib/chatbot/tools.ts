// Retrieval tools for the chatbot — thin wrappers over the same Savetrix
// REST endpoints every other screen in this app calls, modeled directly on
// mcp/mcp-server/src/client/invoices.ts / vendors.ts. Each function takes
// (accessToken, qbConnectionId, args) as required, explicit parameters
// rather than reading them from anywhere ambient — see architecture doc
// §7.3: making qbConnectionId optional is how you accidentally serve one
// company's data as another's.
//
// Deliberately does NOT use src/lib/api.ts: that client is a singleton with
// a request interceptor reading a module-level qbConnectionId (see
// lib/qbConnection.ts) meant for one browser tab's one active session. This
// route handler serves concurrent requests from different users/companies,
// so headers must be attached per-request instead.
import axios from "axios";

import type { ExtractedData, InvoiceRecord } from "@/store/invoice/invoiceSlice";
import type { GLAccount, TaxCode, Vendor } from "@/store/quickBooks/quickBooksSlice";
import { getInvoiceStatus } from "@/lib/invoiceDisplay";
import { ConsumedOperations, mintConsentTicket, verifyConsentTicket } from "./consent";
import {
  toGLAccountChatContext,
  toInvoiceChatContext,
  toInvoiceDetailChatContext,
  toTaxCodeChatContext,
  toVendorChatContext,
  type GLAccountChatContext,
  type InvoiceChatContext,
  type InvoiceDetailChatContext,
  type TaxCodeChatContext,
  type VendorChatContext,
} from "./context";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.savetrix.com/api";

const PAGE_LIMIT = 100;
// Caps how many records any single tool call can hand to the model — keeps
// token usage/cost bounded and doubles as part of the "no rate limiting"
// mitigation from architecture doc §7.11.
const MAX_RESULTS_RETURNED = 20;

// Ids that end up as URL PATH segments come from the model, which means they
// are ultimately influenced by OCR'd invoice text an outsider can author.
// Interpolating one raw is a path-traversal primitive: axios resolves the URL
// through WHATWG `URL`, which collapses dot segments, so an id of
// "../../users/me" escapes both `/invoices/` and the `/api` base and turns a
// scoped tool into arbitrary backend access under the caller's own token.
// encodeURIComponent alone is not enough — it leaves "." untouched — so the
// shape is validated first and the value encoded second.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

class UnsafeIdError extends Error {}

function pathSegment(value: string, field: string): string {
  if (!SAFE_ID.test(value)) {
    throw new UnsafeIdError(
      `Invalid ${field}. Ids must come from a prior tool result and contain only letters, digits, hyphens or underscores.`,
    );
  }
  return encodeURIComponent(value);
}

function savetrixGet<T>(
  path: string,
  accessToken: string,
  qbConnectionId: string,
  params?: Record<string, unknown>,
) {
  return axios.get<T>(path, {
    baseURL: BASE_URL,
    timeout: 30000,
    params,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-QB-Id": qbConnectionId,
    },
  });
}

// POST/PATCH/DELETE variants of savetrixGet — same per-request header
// injection, so write operations are scoped to the requesting user's
// company exactly like reads. Modeled on mcp/mcp-server/src/client/
// invoices.ts and vendors.ts, which call client.api.patch/post/delete with
// the same Bearer + X-QB-Id headers.
function savetrixPost<T>(path: string, body: unknown, accessToken: string, qbConnectionId: string) {
  return axios.post<T>(path, body, {
    baseURL: BASE_URL,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-QB-Id": qbConnectionId,
    },
  });
}

function savetrixPatch<T>(path: string, body: unknown, accessToken: string, qbConnectionId: string) {
  return axios.patch<T>(path, body, {
    baseURL: BASE_URL,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-QB-Id": qbConnectionId,
    },
  });
}

function savetrixDelete<T>(path: string, accessToken: string, qbConnectionId: string) {
  return axios.delete<T>(path, {
    baseURL: BASE_URL,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-QB-Id": qbConnectionId,
    },
  });
}

// Unwraps a write response the same way the read tools' `res.data?.data`
// convention does, then tries the resource-specific nested key the backend
// wraps single-record responses in (mirrors mcp/mcp-server/src/client/
// unwrap.ts's unwrapOne, and quickBooksSlice.ts's own
// `action.payload?.data?.vendor`-style reducers).
function unwrapWriteResult(raw: unknown, keys: string[]): unknown {
  const data = (raw as { data?: unknown })?.data ?? raw;
  if (data && typeof data === "object") {
    for (const key of keys) {
      const nested = (data as Record<string, unknown>)[key];
      if (nested !== undefined && nested !== null) return nested;
    }
  }
  return data;
}

// Destructive actions (post to QB, reject, deactivate) require confirm=true
// before they touch the backend. Mirrors mcp/mcp-server/src/tools/gates.ts's
// requireConfirm exactly — same contract, same shape of result — so the
// model gets a consistent "confirmation required" message whether it's
// talking to this in-app chatbot or the standalone MCP connector.
export interface ConfirmGateResult {
  ok: boolean;
  message?: string;
}

export function requireConfirm(args: { confirm?: boolean }, action: string): ConfirmGateResult {
  if (args.confirm !== true) {
    return {
      ok: false,
      message:
        `Action "${action}" modifies data and requires explicit confirmation. ` +
        "Describe exactly what you're about to do, get the user's explicit agreement, then call this again with confirm: true.",
    };
  }
  return { ok: true };
}

// Required-string-field guard for write tools. OpenAI's function-calling
// schema constrains what the model is TOLD to send, but nothing enforces it
// made it through intact — an empty/missing id here would otherwise become
// a literal "/invoices/undefined" request against the backend instead of a
// clear error. Checked before any network call.
function missingFields<T extends object>(args: T, required: (keyof T & string)[]): string[] {
  return required.filter((key) => {
    const value = args[key];
    return typeof value !== "string" || value.trim() === "";
  });
}

// Fetches every page of /invoices — the backend caps at limit=100/page (see
// getInvoices in src/store/invoice/invoiceApi.ts, the pattern this copies).
// Skipping this would make any "how many/how much" answer silently
// undercount once a company passes 100 invoices (architecture doc §7.4).
async function fetchAllInvoices(
  accessToken: string,
  qbConnectionId: string,
  status?: string,
): Promise<InvoiceRecord[]> {
  type InvoicesResponse = {
    data?: { invoices?: InvoiceRecord[]; pagination?: { totalPages?: number } };
  };

  const baseParams = { limit: PAGE_LIMIT, ...(status ? { status } : {}) };
  const first = await savetrixGet<InvoicesResponse>("/invoices", accessToken, qbConnectionId, {
    page: 1,
    ...baseParams,
  });
  const totalPages = first.data?.data?.pagination?.totalPages || 1;
  let invoices = first.data?.data?.invoices || [];

  if (totalPages > 1) {
    const pageRequests = [];
    for (let page = 2; page <= totalPages; page++) {
      pageRequests.push(
        savetrixGet<InvoicesResponse>("/invoices", accessToken, qbConnectionId, { page, ...baseParams }),
      );
    }
    const rest = await Promise.all(pageRequests);
    for (const res of rest) invoices = invoices.concat(res.data?.data?.invoices || []);
  }

  return invoices;
}

// "2026-01-31" parses as UTC midnight, so comparing an invoice timestamped
// later that day with `date > to` silently drops the whole final day of any
// range — "spend in January" quietly omitted January 31st. A date-only bound
// is therefore widened to the END of that day; a full timestamp is respected
// as given.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseRangeStart(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

function parseRangeEnd(value: string | undefined): Date | null {
  if (!value) return null;
  return new Date(DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value);
}

function withinRange(dateStr: string | undefined, from: Date | null, to: Date | null): boolean {
  if (!from && !to) return true;
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

// ── list_invoices ────────────────────────────────────────────────────────

export interface ListInvoicesArgs {
  status?: "pending" | "manual" | "auto" | "failed" | "processing";
  vendorName?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface ListInvoicesResult {
  invoices: InvoiceChatContext[];
  totalMatched: number;
}

// The backend doesn't support vendorName/date filtering server-side, so
// these are applied in code after fetching, the same way
// src/lib/globalSearch.ts filters already-loaded lists in memory.
export async function listInvoices(
  accessToken: string,
  qbConnectionId: string,
  args: ListInvoicesArgs,
): Promise<ListInvoicesResult> {
  const invoices = await fetchAllInvoices(accessToken, qbConnectionId, args.status);
  const from = parseRangeStart(args.fromDate);
  const to = parseRangeEnd(args.toDate);
  const vendorQuery = args.vendorName?.trim().toLowerCase();

  const filtered = invoices.filter((invoice) => {
    if (vendorQuery) {
      const vendor = invoice.extractedData?.vendorName?.toLowerCase() || "";
      if (!vendor.includes(vendorQuery)) return false;
    }
    return withinRange(invoice.extractedData?.invoiceDate || invoice.createdAt, from, to);
  });

  const limit = Math.max(1, Math.min(args.limit ?? MAX_RESULTS_RETURNED, MAX_RESULTS_RETURNED));
  return {
    invoices: filtered.slice(0, limit).map(toInvoiceChatContext),
    totalMatched: filtered.length,
  };
}

// ── get_invoice_detail ───────────────────────────────────────────────────

export async function getInvoiceDetail(
  accessToken: string,
  qbConnectionId: string,
  args: { invoiceId: string },
): Promise<InvoiceDetailChatContext | { error: string }> {
  try {
    const res = await savetrixGet<{ data?: { invoice?: InvoiceRecord } | InvoiceRecord }>(
      `/invoices/${pathSegment(args.invoiceId, "invoiceId")}`,
      accessToken,
      qbConnectionId,
    );
    const payload = res.data?.data;
    const invoice =
      payload && typeof payload === "object" && "invoice" in payload
        ? (payload as { invoice?: InvoiceRecord }).invoice
        : (payload as InvoiceRecord | undefined);
    if (!invoice) return { error: "Invoice not found." };
    return toInvoiceDetailChatContext(invoice);
  } catch {
    return { error: "Could not fetch that invoice. It may not exist, or may belong to a different company." };
  }
}

// ── summarize_spend ──────────────────────────────────────────────────────

export interface SummarizeSpendArgs {
  groupBy: "vendor" | "month" | "status";
  fromDate?: string;
  toDate?: string;
}

export interface SpendGroup {
  key: string;
  totals: { currency: string; total: number; count: number }[];
}

// Computes sums/counts in TypeScript instead of handing the model a list of
// raw amounts to add up itself (LLMs are unreliable at exact arithmetic —
// architecture doc §7.5). Groups by currency within each key so USD and EUR
// invoices, e.g., are never silently summed together (§7.7), following the
// same pattern as src/lib/topVendors.ts.
export async function summarizeSpend(
  accessToken: string,
  qbConnectionId: string,
  args: SummarizeSpendArgs,
): Promise<{ groups: SpendGroup[] }> {
  const invoices = await fetchAllInvoices(accessToken, qbConnectionId);
  const from = parseRangeStart(args.fromDate);
  const to = parseRangeEnd(args.toDate);

  const filtered = invoices.filter((invoice) =>
    withinRange(invoice.extractedData?.invoiceDate || invoice.createdAt, from, to),
  );

  const groups = new Map<string, Map<string, { total: number; count: number }>>();

  for (const invoice of filtered) {
    let key: string;
    if (args.groupBy === "vendor") {
      key = invoice.extractedData?.vendorName?.trim() || "Unknown vendor";
    } else if (args.groupBy === "status") {
      key = getInvoiceStatus(invoice.postedStatus);
    } else {
      const dateStr = invoice.extractedData?.invoiceDate || invoice.createdAt;
      const date = dateStr ? new Date(dateStr) : null;
      key =
        date && !Number.isNaN(date.getTime())
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
          : "Unknown month";
    }

    const currency = invoice.extractedData?.currency || "Unknown";
    const amount = invoice.extractedData?.totalAmount || 0;

    if (!groups.has(key)) groups.set(key, new Map());
    const currencyTotals = groups.get(key)!;
    const existing = currencyTotals.get(currency) || { total: 0, count: 0 };
    existing.total += amount;
    existing.count += 1;
    currencyTotals.set(currency, existing);
  }

  return {
    groups: [...groups.entries()].map(([key, currencyTotals]) => ({
      key,
      totals: [...currencyTotals.entries()].map(([currency, data]) => ({ currency, ...data })),
    })),
  };
}

// ── list_vendors / list_gl_accounts / list_tax_codes ────────────────────

export async function listVendors(
  accessToken: string,
  qbConnectionId: string,
  args: { status?: "active" | "inactive" },
): Promise<{ vendors: VendorChatContext[] }> {
  const res = await savetrixGet<{ data?: { vendors?: Vendor[] } }>(
    "/quickbooks/vendors",
    accessToken,
    qbConnectionId,
    args.status === "inactive" ? { status: "inactive" } : undefined,
  );
  const vendors = res.data?.data?.vendors || [];
  return { vendors: vendors.slice(0, MAX_RESULTS_RETURNED).map(toVendorChatContext) };
}

export async function listGLAccounts(
  accessToken: string,
  qbConnectionId: string,
): Promise<{ accounts: GLAccountChatContext[] }> {
  const res = await savetrixGet<{ data?: { accounts?: GLAccount[] } }>(
    "/quickbooks/accounts",
    accessToken,
    qbConnectionId,
  );
  const accounts = res.data?.data?.accounts || [];
  return { accounts: accounts.slice(0, MAX_RESULTS_RETURNED).map(toGLAccountChatContext) };
}

export async function listTaxCodes(
  accessToken: string,
  qbConnectionId: string,
): Promise<{ taxCodes: TaxCodeChatContext[] }> {
  // /quickbooks/taxcodes wraps its payload as data.items, not data.taxCodes —
  // see quickBooksApi.ts's fetchQuickBooksTaxCodes comment. Fall back across
  // every shape that's been observed, same as that thunk.
  const res = await savetrixGet<{ data?: unknown }>("/quickbooks/taxcodes", accessToken, qbConnectionId);
  const payload = res.data?.data as
    | { items?: TaxCode[]; taxCodes?: TaxCode[]; taxcodes?: TaxCode[] }
    | TaxCode[]
    | undefined;
  const items: TaxCode[] = Array.isArray(payload)
    ? payload
    : payload?.items || payload?.taxCodes || payload?.taxcodes || [];
  return { taxCodes: items.slice(0, MAX_RESULTS_RETURNED).map(toTaxCodeChatContext) };
}

// ── Write: Invoice ───────────────────────────────────────────────────────

export interface UpdateInvoiceArgs {
  invoiceId: string;
  extractedData: Partial<ExtractedData>;
}

// PATCH /invoices/:id — updates the extracted data on an invoice (vendor,
// amount, GL account, tax code, line items, dates, etc.) without posting it.
// Mirrors mcp/mcp-server/src/client/invoices.ts's updateInvoiceExtractedData
// and src/store/invoice/invoiceApi.ts's updateInvoiceExtractedData thunk.
export async function updateInvoice(
  accessToken: string,
  qbConnectionId: string,
  args: UpdateInvoiceArgs,
): Promise<unknown> {
  const missing = missingFields(args, ["invoiceId"]);
  if (missing.length) return { success: false, message: `Missing required field(s): ${missing.join(", ")}.` };

  const res = await savetrixPatch(
    `/invoices/${pathSegment(args.invoiceId, "invoiceId")}`,
    { extractedData: args.extractedData },
    accessToken,
    qbConnectionId,
  );
  const invoice = unwrapWriteResult(res.data, ["invoice"]);
  return isInvoiceRecord(invoice) ? toInvoiceDetailChatContext(invoice) : { success: true };
}

export interface PostInvoiceToQbArgs {
  invoiceId: string;
  vendorId: string;
  extractedData: Partial<ExtractedData>;
  confirm: boolean;
}

// Concurrent-post lock, mirroring the postInvoiceToQuickBooks thunk in
// src/store/invoice/invoiceApi.ts: two posts of the same invoice in flight at
// once both pass the idempotency preflight before either commits, and the
// second PATCH creates a duplicate bill.
//
// Scope, precisely: this module runs SERVER-side in the /api/chat route, so it
// is a different process from the browser's copy and the two cannot see each
// other — this does NOT stop the review page and the chatbot racing. It is
// also per-instance, so it does not span Vercel's instance fan-out. It closes
// the same-instance repeat, and the preflight above plus the backend remain
// the real defences.
const postingInFlight = new Set<string>();

// PATCH /invoices/:id with vendorId + postedStatus:"manual" — sends an
// approved invoice into QuickBooks. Destructive: requires confirm=true.
// Mirrors mcp/mcp-server/src/client/invoices.ts's postInvoiceToQuickBooks and
// src/store/invoice/invoiceApi.ts's postInvoiceToQuickBooks thunk.
export async function postInvoiceToQuickBooks(
  accessToken: string,
  qbConnectionId: string,
  args: PostInvoiceToQbArgs,
): Promise<unknown> {
  const gate = requireConfirm(args, "post invoice to QuickBooks");
  if (!gate.ok) return { success: false, message: gate.message, confirmationRequired: true };
  const missing = missingFields(args, ["invoiceId", "vendorId"]);
  if (missing.length) return { success: false, message: `Missing required field(s): ${missing.join(", ")}.` };

  if (postingInFlight.has(args.invoiceId)) {
    return { success: false, message: "That invoice is already being posted to QuickBooks — not posting it again." };
  }
  postingInFlight.add(args.invoiceId);

  try {
    // Idempotency guard — same reasoning as the invoiceApi.ts thunk. The scan
    // pipeline is not transactional, so an invoice can carry a billId / terminal
    // posted status while the model still sees it as "pending" from an earlier
    // fetch. Re-posting creates a duplicate bill in QuickBooks (the exact bug
    // the tools.ts:847 comment calls out), so fetch current state first and
    // refuse when the bill already exists.
    try {
      const preflight = await savetrixGet<{ data?: { invoice?: InvoiceRecord } | InvoiceRecord }>(
        `/invoices/${pathSegment(args.invoiceId, "invoiceId")}`,
        accessToken,
        qbConnectionId,
      );
      const payload = preflight.data?.data;
      const invoice =
        payload && typeof payload === "object" && "invoice" in payload
          ? (payload as { invoice?: InvoiceRecord }).invoice
          : (payload as InvoiceRecord | undefined);

      if (invoice) {
        const alreadyPosted =
          invoice.postedStatus === "auto" ||
          invoice.postedStatus === "manual" ||
          Boolean(invoice.quickbooks?.billId);
        if (alreadyPosted) {
          return {
            success: false,
            message: `Invoice ${args.invoiceId} is already posted to QuickBooks${invoice.quickbooks?.billId ? ` (bill #${invoice.quickbooks.billId})` : ""}. Refusing to post again so no duplicate bill is created.`,
          };
        }
      }
    } catch {
      // Preflight fetch failed — fall through and let the PATCH itself surface
      // the real error rather than blocking a legitimate first post.
    }

    const res = await savetrixPatch(
      `/invoices/${pathSegment(args.invoiceId, "invoiceId")}`,
      { vendorId: args.vendorId, postedStatus: "manual", extractedData: args.extractedData },
      accessToken,
      qbConnectionId,
    );
    const invoice = unwrapWriteResult(res.data, ["invoice"]);
    return isInvoiceRecord(invoice) ? toInvoiceDetailChatContext(invoice) : { success: true };
  } finally {
    postingInFlight.delete(args.invoiceId);
  }
}

export interface RejectInvoiceArgs {
  invoiceId: string;
  reason?: string;
  confirm: boolean;
}

// PATCH /invoices/:id with postedStatus:"failed" — rejects an invoice
// (duplicate, bad scan, etc). Destructive: requires confirm=true. Mirrors
// mcp/mcp-server/src/client/invoices.ts's rejectInvoice and
// src/store/invoice/invoiceApi.ts's rejectInvoice thunk.
export async function rejectInvoice(
  accessToken: string,
  qbConnectionId: string,
  args: RejectInvoiceArgs,
): Promise<unknown> {
  const gate = requireConfirm(args, "reject invoice");
  if (!gate.ok) return { success: false, message: gate.message, confirmationRequired: true };
  const missing = missingFields(args, ["invoiceId"]);
  if (missing.length) return { success: false, message: `Missing required field(s): ${missing.join(", ")}.` };

  const res = await savetrixPatch(
    `/invoices/${pathSegment(args.invoiceId, "invoiceId")}`,
    { postedStatus: "failed", ...(args.reason ? { reason: args.reason } : {}) },
    accessToken,
    qbConnectionId,
  );
  const invoice = unwrapWriteResult(res.data, ["invoice"]);
  return isInvoiceRecord(invoice) ? toInvoiceDetailChatContext(invoice) : { success: true };
}

// ── Write: Vendor ────────────────────────────────────────────────────────

export interface CreateVendorArgs {
  displayName: string;
  currency: string;
  glAccountId: string;
  email?: string;
  phone?: string;
  address?: string;
  taxCodeId?: string;
}

// POST /quickbooks/vendors — creates a new vendor in QuickBooks. Mirrors
// mcp/mcp-server/src/client/vendors.ts's createVendor and
// src/store/quickBooks/quickBooksApi.ts's createQuickBooksVendor thunk.
//
// glAccountId is required here even though the backend field itself accepts
// an empty string on the wire — the *business* rule that every vendor needs
// a default GL account is enforced client-side in the human UI
// (VendorsContent.tsx's required-field gate on the create form), not by the
// backend rejecting "". Validating it here, before the POST, means the model
// finds out it needs to ask the user which GL account to use instead of
// discovering that only after a live backend error round-trip.
export async function createVendor(
  accessToken: string,
  qbConnectionId: string,
  args: CreateVendorArgs,
): Promise<unknown> {
  const missing = missingFields(args, ["displayName", "currency", "glAccountId"]);
  if (missing.length) return { success: false, message: `Missing required field(s): ${missing.join(", ")}.` };

  const res = await savetrixPost(
    "/quickbooks/vendors",
    {
      displayName: args.displayName,
      currency: args.currency,
      glAccountId: args.glAccountId,
      taxCodeId: args.taxCodeId ?? "",
      ...(args.email ? { email: args.email } : {}),
      ...(args.phone ? { phone: args.phone } : {}),
      ...(args.address ? { address: args.address } : {}),
    },
    accessToken,
    qbConnectionId,
  );
  const vendor = unwrapWriteResult(res.data, ["vendor"]);
  return isVendor(vendor) ? toVendorChatContext(vendor) : { success: true };
}

export interface UpdateVendorArgs {
  vendorId: string;
  displayName?: string;
  currency?: string;
  email?: string;
  phone?: string;
  address?: string;
  glAccountId?: string;
  taxCodeId?: string;
}

// PATCH /quickbooks/vendors/:id — updates a vendor's details. Mirrors
// mcp/mcp-server/src/client/vendors.ts's updateVendor and
// src/store/quickBooks/quickBooksApi.ts's updateQuickBooksVendor thunk.
export async function updateVendor(
  accessToken: string,
  qbConnectionId: string,
  args: UpdateVendorArgs,
): Promise<unknown> {
  const missing = missingFields(args, ["vendorId"]);
  if (missing.length) return { success: false, message: `Missing required field(s): ${missing.join(", ")}.` };

  const { vendorId, ...fields } = args;
  const body: Record<string, string> = {};
  for (const key of ["displayName", "currency", "email", "phone", "address", "glAccountId", "taxCodeId"] as const) {
    if (fields[key] !== undefined) body[key] = fields[key] as string;
  }
  const res = await savetrixPatch(`/quickbooks/vendors/${pathSegment(vendorId, "vendorId")}`, body, accessToken, qbConnectionId);
  const vendor = unwrapWriteResult(res.data, ["vendor"]);
  return isVendor(vendor) ? toVendorChatContext(vendor) : { success: true };
}

export interface DeactivateVendorArgs {
  vendorId: string;
  confirm: boolean;
}

// DELETE /quickbooks/vendors/:id — deactivates a vendor (hidden, not
// destroyed — see reactivateVendor below). Destructive: requires
// confirm=true. Mirrors mcp/mcp-server/src/client/vendors.ts's
// deactivateVendor and src/store/quickBooks/quickBooksApi.ts's
// deleteQuickBooksVendor thunk.
export async function deactivateVendor(
  accessToken: string,
  qbConnectionId: string,
  args: DeactivateVendorArgs,
): Promise<unknown> {
  const gate = requireConfirm(args, "deactivate vendor");
  if (!gate.ok) return { success: false, message: gate.message, confirmationRequired: true };
  const missing = missingFields(args, ["vendorId"]);
  if (missing.length) return { success: false, message: `Missing required field(s): ${missing.join(", ")}.` };

  await savetrixDelete(`/quickbooks/vendors/${pathSegment(args.vendorId, "vendorId")}`, accessToken, qbConnectionId);
  return { success: true, vendorId: args.vendorId, status: "inactive" };
}

export interface ReactivateVendorArgs {
  vendorId: string;
}

// POST /quickbooks/vendors/:id/reactivate — brings back a deactivated
// vendor. Mirrors mcp/mcp-server/src/client/vendors.ts's reactivateVendor
// and src/store/quickBooks/quickBooksApi.ts's reactivateQuickBooksVendor
// thunk.
export async function reactivateVendor(
  accessToken: string,
  qbConnectionId: string,
  args: ReactivateVendorArgs,
): Promise<unknown> {
  const missing = missingFields(args, ["vendorId"]);
  if (missing.length) return { success: false, message: `Missing required field(s): ${missing.join(", ")}.` };

  const res = await savetrixPost(`/quickbooks/vendors/${pathSegment(args.vendorId, "vendorId")}/reactivate`, {}, accessToken, qbConnectionId);
  const vendor = unwrapWriteResult(res.data, ["vendor"]);
  return isVendor(vendor) ? toVendorChatContext(vendor) : { success: true, vendorId: args.vendorId, status: "active" };
}

// ── Write: GL Account ────────────────────────────────────────────────────

export interface CreateGLAccountArgs {
  name: string;
  accountType: string;
  accountSubType?: string;
}

// POST /quickbooks/accounts — creates a new GL account in QuickBooks.
// Mirrors mcp/mcp-server/src/client/accounts.ts's createAccount and
// src/store/quickBooks/quickBooksApi.ts's createQuickBooksAccount thunk.
export async function createGLAccount(
  accessToken: string,
  qbConnectionId: string,
  args: CreateGLAccountArgs,
): Promise<unknown> {
  const missing = missingFields(args, ["name", "accountType"]);
  if (missing.length) return { success: false, message: `Missing required field(s): ${missing.join(", ")}.` };

  const res = await savetrixPost(
    "/quickbooks/accounts",
    { name: args.name, accountType: args.accountType, ...(args.accountSubType ? { accountSubType: args.accountSubType } : {}) },
    accessToken,
    qbConnectionId,
  );
  const account = unwrapWriteResult(res.data, ["account"]);
  return isGLAccount(account) ? toGLAccountChatContext(account) : { success: true };
}

// The sync endpoints answer with a counts summary, but nothing guaranteed
// that — if the backend also echoes the synced records, returning its payload
// verbatim would forward raw GLAccount/TaxCode rows (qbConnectionId, realmId,
// qbAccountId, isDeleted) to the model, which is exactly what context.ts
// exists to prevent. Allow-list the scalar counters instead of trusting the
// shape (architecture doc §4.5).
const SYNC_COUNT_KEYS = ["synced", "added", "updated", "removed", "deactivated", "total"] as const;

function toSyncSummary(raw: unknown): Record<string, number | string> {
  if (!raw || typeof raw !== "object") return { success: "ok" };
  const source = raw as Record<string, unknown>;
  const summary: Record<string, number | string> = {};
  for (const key of SYNC_COUNT_KEYS) {
    if (typeof source[key] === "number") summary[key] = source[key] as number;
  }
  if (typeof source.message === "string") summary.message = source.message;
  return Object.keys(summary).length ? summary : { success: "ok" };
}

// POST /quickbooks/accounts/sync — pulls the latest GL accounts from
// QuickBooks into the app's own store. Non-destructive (no data lost), so no
// confirm gate. Not in the standalone MCP connector's public tool set today,
// but mirrors savetrix_account_sync there for parity.
export async function syncGLAccounts(accessToken: string, qbConnectionId: string): Promise<unknown> {
  const res = await savetrixPost("/quickbooks/accounts/sync", {}, accessToken, qbConnectionId);
  return toSyncSummary(unwrapWriteResult(res.data, []));
}

// POST /quickbooks/taxcodes/sync — pulls the latest tax codes from
// QuickBooks into the app's own store. Non-destructive. Mirrors
// savetrix_taxcode_sync in the standalone MCP connector.
export async function syncTaxCodes(accessToken: string, qbConnectionId: string): Promise<unknown> {
  const res = await savetrixPost("/quickbooks/taxcodes/sync", {}, accessToken, qbConnectionId);
  return toSyncSummary(unwrapWriteResult(res.data, []));
}

// Type guards gate which shrink-to-chat-context mapper applies to a write
// response — see architecture doc §4.5/§7.6. A write response's exact shape
// varies by endpoint and isn't independently verified against a live
// backend here, so these fall back to a minimal {success:true} rather than
// risk forwarding an unshrunk raw record if the shape doesn't match.
function isInvoiceRecord(value: unknown): value is InvoiceRecord {
  return Boolean(value) && typeof value === "object" && typeof (value as InvoiceRecord)._id === "string";
}

function isVendor(value: unknown): value is Vendor {
  return Boolean(value) && typeof value === "object" && typeof (value as Vendor)._id === "string";
}

function isGLAccount(value: unknown): value is GLAccount {
  return Boolean(value) && typeof value === "object" && typeof (value as GLAccount)._id === "string";
}

// ── dispatcher ───────────────────────────────────────────────────────────

export const TOOL_NAMES = [
  "list_invoices",
  "get_invoice_detail",
  "summarize_spend",
  "list_vendors",
  "list_gl_accounts",
  "list_tax_codes",
  // ── write tools ──────────────────────────────────────────────────────────
  "update_invoice",
  "post_invoice_to_qb",
  "reject_invoice",
  "create_vendor",
  "update_vendor",
  "deactivate_vendor",
  "reactivate_vendor",
  "create_gl_account",
  "sync_accounts",
  "sync_tax_codes",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

// Same precedence as getErrorMessage in src/store/invoice/invoiceApi.ts —
// the backend's own message is far more actionable for a write than a
// generic string ("Vendor with this email already exists" vs. "failed"),
// so this is deliberately more specific than the read tools' catch-all
// below. Never includes raw error.stack/internals — only what the backend
// itself chose to put in the response body, or axios's own short summary.
function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | undefined;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

// Every branch is caught individually so one failed Savetrix call becomes a
// plain-language tool result the model can relay ("couldn't find that"),
// never a crash of the whole streaming response.
// Tools whose effects a user cannot undo from the chat panel. `confirm: true`
// alone does NOT authorize these — see the gate in callTool below.
export const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  "post_invoice_to_qb",
  "reject_invoice",
  "deactivate_vendor",
]);

export interface CallToolOptions {
  /**
   * True only when the CLIENT reports that the human accepted the confirmation
   * dialog on this turn. Set from the request body, never from anything the
   * model produced.
   */
  userConfirmed?: boolean;
  /**
   * Id of the HTTP request being served. Consent tickets record the request
   * that minted them and are refused inside that same request, so the model
   * cannot mint one and spend it without the turn ending first.
   */
  requestId?: string;
  /** Request-scoped guard against the same write running twice in one turn. */
  consumed?: ConsumedOperations;
  /**
   * Consent ticket the CLIENT sent back with this request, having received it
   * out of band on the turn where confirmation was requested. Never sourced
   * from model output.
   */
  confirmedTicket?: string;
  /**
   * Tickets minted while serving this request, for the route to hand to the
   * client. Only the first is used — one pending confirmation at a time.
   */
  pendingTickets?: string[];
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  accessToken: string,
  qbConnectionId: string,
  options: CallToolOptions = {},
): Promise<unknown> {
  try {
    // `requireConfirm` inside each destructive tool checks `args.confirm`,
    // which the MODEL writes — so on its own it authorizes nothing. Probing
    // this with the real prompt and schemas, the model set confirm:true and
    // executed a write on the very first turn (user said "I confirm, just do
    // it") with no dialog ever shown, and after a generic "Yes, proceed."
    // resolved an ambiguous vendor name to one of two near-identical records
    // on its own. So the human's actual click, reported by the client and
    // checked here, is the authorization; the model's flag is only a hint
    // about intent. Fails closed: no click, no write.
    if (DESTRUCTIVE_TOOLS.has(name)) {
      const requestId = options.requestId ?? "";
      // Factor 1 — the human actually clicked. Not expressible by the model.
      if (options.userConfirmed !== true) {
        const ticket = requestId ? mintConsentTicket(name, args, accessToken, requestId) : undefined;
        if (ticket) options.pendingTickets?.push(ticket);
        return {
          success: false,
          confirmationRequired: true,
          message:
            `Action "${name}" needs the user to confirm it in the app before it can run. ` +
            "Describe exactly what you are about to do — naming the specific record — then ask them to confirm. " +
            "When they confirm, call this tool again with exactly the same arguments you just described.",
        };
      }

      // Factor 2 — the arguments are the ones that were described to them.
      // Without this, a click meant for "deactivate Acme Corp" authorizes
      // whatever the model passes next.
      const verdict = verifyConsentTicket(
        options.confirmedTicket,
        name,
        args,
        accessToken,
        requestId,
      );
      if (!verdict.ok) {
        const ticket = requestId ? mintConsentTicket(name, args, accessToken, requestId) : undefined;
        if (ticket) options.pendingTickets?.push(ticket);
        return {
          success: false,
          confirmationRequired: true,
          message:
            verdict.reason === "mismatch"
              ? "That confirmation was for a different record or different details than the ones you just sent. " +
                "Describe the exact change you want to make now and ask the user to confirm it again."
              : verdict.reason === "expired"
                ? "That confirmation has expired. Please ask the user to confirm again."
                : "This action still needs the user's confirmation for these exact details.",
        };
      }

      // Single-use within the turn: the model does sometimes repeat a call,
      // and a repeated post-to-QuickBooks is a duplicate bill.
      if (options.consumed && !options.consumed.claim(name, args)) {
        return {
          success: false,
          message: "That action was already carried out in this turn — not repeating it.",
        };
      }
    }

    switch (name as ToolName) {
      case "list_invoices":
        return await listInvoices(accessToken, qbConnectionId, args as ListInvoicesArgs);
      case "get_invoice_detail":
        return await getInvoiceDetail(accessToken, qbConnectionId, args as { invoiceId: string });
      case "summarize_spend":
        return await summarizeSpend(accessToken, qbConnectionId, args as unknown as SummarizeSpendArgs);
      case "list_vendors":
        return await listVendors(accessToken, qbConnectionId, args as { status?: "active" | "inactive" });
      case "list_gl_accounts":
        return await listGLAccounts(accessToken, qbConnectionId);
      case "list_tax_codes":
        return await listTaxCodes(accessToken, qbConnectionId);
      // ── write tools ────────────────────────────────────────────────────────
      case "update_invoice":
        return await updateInvoice(accessToken, qbConnectionId, args as unknown as UpdateInvoiceArgs);
      case "post_invoice_to_qb":
        return await postInvoiceToQuickBooks(accessToken, qbConnectionId, args as unknown as PostInvoiceToQbArgs);
      case "reject_invoice":
        return await rejectInvoice(accessToken, qbConnectionId, args as unknown as RejectInvoiceArgs);
      case "create_vendor":
        return await createVendor(accessToken, qbConnectionId, args as unknown as CreateVendorArgs);
      case "update_vendor":
        return await updateVendor(accessToken, qbConnectionId, args as unknown as UpdateVendorArgs);
      case "deactivate_vendor":
        return await deactivateVendor(accessToken, qbConnectionId, args as unknown as DeactivateVendorArgs);
      case "reactivate_vendor":
        return await reactivateVendor(accessToken, qbConnectionId, args as unknown as ReactivateVendorArgs);
      case "create_gl_account":
        return await createGLAccount(accessToken, qbConnectionId, args as unknown as CreateGLAccountArgs);
      case "sync_accounts":
        return await syncGLAccounts(accessToken, qbConnectionId);
      case "sync_tax_codes":
        return await syncTaxCodes(accessToken, qbConnectionId);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { success: false, message: extractErrorMessage(error) };
  }
}
