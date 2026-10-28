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
    throw new LedgerError("Scantrix couldn't reach the accounting connection just now. Try again.", "definite", "unavailable");
  }
  const body = (await res.json().catch(() => null)) as { message?: string; data?: Record<string, unknown> | null } | null;
  if (res.status === 409) throw new LedgerError(body?.message || "Reconnect the accounting software first.", "definite", "reconnect");
  if (res.status === 403) throw new LedgerError(body?.message || "Your role can't post to the accounting software.", "definite", "permission");
  if (res.status === 404 && !body?.data) throw new LedgerError("This backend doesn't support posting bank lines yet.", "definite", "not_configured");
  if (res.status === 503) throw new LedgerError("Posting isn't switched on on the backend yet.", "definite", "not_configured");
  const d = body?.data;
  if (!res.ok || !d || typeof d.accessToken !== "string" || typeof d.tenantId !== "string") {
    throw new LedgerError(body?.message || "Scantrix couldn't open the accounting connection. Try again.", "definite", "unavailable");
  }
  return {
    provider: (d.provider === "xero" ? "xero" : "quickbooks") as LedgerProvider,
    tenantId: d.tenantId,
    accessToken: d.accessToken,
    environment: typeof d.environment === "string" ? d.environment : "production",
    shortCode: typeof d.shortCode === "string" ? d.shortCode : null,
  };
}

async function getList<T>(userToken: string, qbConnectionId: string, path: string, pick: (data: Record<string, unknown>) => T[] | undefined): Promise<T[]> {
  let res: Response;
  try {
    res = await fetch(`${SAVETRIX_API_BASE_URL}${path}`, { headers: headers(userToken, qbConnectionId), signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch {
    throw new LedgerError("Scantrix couldn't load the company's lists just now. Try again.", "definite", "unavailable");
  }
  if (!res.ok) throw new LedgerError(`Scantrix couldn't load the company's lists (${res.status}). Try again.`, "definite", "unavailable");
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
  return pick(body?.data ?? {}) ?? [];
}

/** Scantrix vendor id (`_id`) → the vendor's id in QuickBooks/Xero. */
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
    throw new LedgerError("Scantrix couldn't load the matched bill just now. Try again.", "definite", "unavailable");
  }
  const q = result.invoice.quickbooks;
  return q?.billId && q?.vendorId ? { billId: q.billId, vendorId: q.vendorId } : null;
}
