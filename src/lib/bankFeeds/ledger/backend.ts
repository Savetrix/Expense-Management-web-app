// SERVER-ONLY. What posting needs from the Savetrix backend, always asked as
// the signed-in user (their token + X-QB-Id), so the backend's own role rules
// apply on top of ours.
import { SAVETRIX_API_BASE_URL } from "../config";
import { fetchInvoice } from "../invoiceInsights";

import { LedgerError, type LedgerContext, type LedgerProvider } from "./types";

/**
 * The shared secret the backend expects in X-Service-Key on
 * POST /accounting/access-token. Unset = posting is switched off here.
 */
export function serviceKey(): string | null {
  return process.env.WEB_APP_SERVICE_KEY?.trim() || null;
}

const headers = (userToken: string, qbConnectionId: string) => ({
  Authorization: `Bearer ${userToken}`,
  "X-QB-Id": qbConnectionId,
  Accept: "application/json",
});

/**
 * A working QuickBooks/Xero access token for this company, from the backend.
 * The backend refreshes it under its own lock; this server never refreshes,
 * because two refreshers would spend single-use refresh tokens and drop the
 * connection.
 */
export async function getLedgerContext(userToken: string, qbConnectionId: string): Promise<LedgerContext> {
  const key = serviceKey();
  if (!key) throw new LedgerError("Posting to the accounting software isn't switched on on this server yet.", "definite", "not_configured");
  let res: Response;
  try {
    res = await fetch(`${SAVETRIX_API_BASE_URL}/accounting/access-token`, {
      method: "POST",
      headers: { ...headers(userToken, qbConnectionId), "X-Service-Key": key },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new LedgerError("ScanTrix couldn't reach the accounting connection just now. Try again.", "definite", "unavailable");
  }
  const body = (await res.json().catch(() => null)) as { message?: string; data?: Record<string, unknown> | null } | null;
  if (res.status === 409) throw new LedgerError(body?.message || "Reconnect the accounting software first.", "definite", "reconnect");
  if (res.status === 403) throw new LedgerError(body?.message || "Your role can't post to the accounting software.", "definite", "permission");
  if (res.status === 404 && !body?.data) throw new LedgerError("This backend doesn't support posting bank lines yet.", "definite", "not_configured");
  if (res.status === 503) throw new LedgerError("Posting isn't switched on on the backend yet.", "definite", "not_configured");
  const d = body?.data;
  if (!res.ok || !d || typeof d.accessToken !== "string" || typeof d.tenantId !== "string") {
    throw new LedgerError(body?.message || "ScanTrix couldn't open the accounting connection. Try again.", "definite", "unavailable");
  }
  return {
    provider: (d.provider === "xero" ? "xero" : "quickbooks") as LedgerProvider,
    tenantId: d.tenantId,
    accessToken: d.accessToken,
    environment: typeof d.environment === "string" ? d.environment : "production",
    shortCode: typeof d.shortCode === "string" ? d.shortCode : null,
  };
}

export async function getList<T>(userToken: string, qbConnectionId: string, path: string, pick: (data: Record<string, unknown>) => T[] | undefined): Promise<T[]> {
  let res: Response;
  try {
    res = await fetch(`${SAVETRIX_API_BASE_URL}${path}`, { headers: headers(userToken, qbConnectionId), signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch {
    throw new LedgerError("ScanTrix couldn't load the company's lists just now. Try again.", "definite", "unavailable");
  }
  if (!res.ok) throw new LedgerError(`ScanTrix couldn't load the company's lists (${res.status}). Try again.`, "definite", "unavailable");
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
  return pick(body?.data ?? {}) ?? [];
}

/** ScanTrix vendor id (`_id`) → the vendor's id in QuickBooks/Xero. */
export async function vendorExternalIds(userToken: string, qbConnectionId: string): Promise<Map<string, string>> {
  const vendors = await getList<{ _id?: string; qbVendorId?: string }>(userToken, qbConnectionId, "/quickbooks/vendors", (d) => d.vendors as never);
  return new Map(vendors.filter((v) => v._id && v.qbVendorId).map((v) => [String(v._id), String(v.qbVendorId)]));
}

/** Tax code id (as stored on a bank line) → total rate in percent. */
export async function taxRates(userToken: string, qbConnectionId: string): Promise<Map<string, number>> {
  const items = await getList<{ id?: string; qbTaxCodeId?: string; Id?: string; _id?: string; totalRate?: number | null }>(userToken, qbConnectionId, "/quickbooks/taxcodes", (d) =>
    (d.items ?? d.taxCodes ?? d.taxcodes) as never,
  );
  const out = new Map<string, number>();
  for (const t of items) {
    const id = t.id ?? t.qbTaxCodeId ?? t.Id ?? t._id;
    if (id && typeof t.totalRate === "number") out.set(String(id), t.totalRate);
  }
  return out;
}

/** The bill a line is matched to, as it is in QuickBooks/Xero (null = not posted there yet). */
export async function postedBill(userToken: string, qbConnectionId: string, invoiceId: string): Promise<{ billId: string; vendorId: string } | null> {
  const result = await fetchInvoice(userToken, qbConnectionId, invoiceId);
  if (!result.ok) {
    if (result.status === 404) return null;
    throw new LedgerError("ScanTrix couldn't load the matched bill just now. Try again.", "definite", "unavailable");
  }
  const q = result.invoice.quickbooks;
  return q?.billId && q?.vendorId ? { billId: q.billId, vendorId: q.vendorId } : null;
}

/** A bill in the backend's invoice list, reduced to what history and step 3 need. */
export interface ScantrixInvoice {
  id: string;
  billId: string | null;
  /** Posted by a person ("manual"), not auto-posted. */
  byPerson: boolean;
  vendorName: string;
  lines: string[];
  glAccountId: string | null;
  taxCodeId: string | null;
  date: string;
  amountCents: number | null;
  decidedAt: string;
}

/** The company's invoices from the backend (all pages), as the signed-in user. */
export async function scantrixInvoices(userToken: string, qbConnectionId: string): Promise<ScantrixInvoice[]> {
  const out: ScantrixInvoice[] = [];
  for (let page = 1, pages = 1; page <= pages && page <= 200; page++) {
    let res: Response;
    try {
      res = await fetch(`${SAVETRIX_API_BASE_URL}/invoices?page=${page}&limit=100`, { headers: headers(userToken, qbConnectionId), signal: AbortSignal.timeout(20_000), cache: "no-store" });
    } catch {
      throw new LedgerError("ScanTrix couldn't load its own bills just now. Try again.", "definite", "unavailable");
    }
    if (!res.ok) throw new LedgerError(`ScanTrix couldn't load its own bills (${res.status}). Try again.`, "definite", "unavailable");
    type Raw = {
      _id?: string;
      postedStatus?: string;
      updatedAt?: string;
      createdAt?: string;
      quickbooks?: { billId?: string | null; postedAt?: string | null };
      extractedData?: { vendorName?: string; invoiceDate?: string | null; totalAmount?: number; glAccountId?: string | null; taxCodeId?: string | null; lineItems?: { description?: string | null }[] };
    };
    const body = (await res.json().catch(() => null)) as { data?: { invoices?: Raw[]; pagination?: { totalPages?: number } } } | null;
    for (const inv of body?.data?.invoices ?? []) {
      if (!inv._id) continue;
      const d = inv.extractedData ?? {};
      out.push({
        id: inv._id,
        billId: inv.quickbooks?.billId ? String(inv.quickbooks.billId) : null,
        byPerson: inv.postedStatus === "manual",
        vendorName: d.vendorName ?? "",
        lines: (d.lineItems ?? []).map((l) => l.description ?? "").filter(Boolean),
        glAccountId: d.glAccountId ?? null,
        taxCodeId: d.taxCodeId ?? null,
        date: (d.invoiceDate ?? inv.createdAt ?? "").slice(0, 10),
        amountCents: typeof d.totalAmount === "number" ? Math.round(Math.abs(d.totalAmount) * 100) : null,
        decidedAt: inv.quickbooks?.postedAt ?? inv.updatedAt ?? inv.createdAt ?? new Date(0).toISOString(),
      });
    }
    pages = Math.max(1, Number(body?.data?.pagination?.totalPages) || 1);
  }
  return out;
}

/** The QuickBooks/Xero ids of the bills ScanTrix posted (history leaves these out). */
export async function scantrixBillIds(userToken: string, qbConnectionId: string): Promise<Set<string>> {
  return new Set((await scantrixInvoices(userToken, qbConnectionId)).map((i) => i.billId).filter((id): id is string => Boolean(id)));
}
