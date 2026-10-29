// SERVER-ONLY. The posting services for one request: a working token from the
// backend, the provider's adapter, and the backend lookups posting needs.
import { fail } from "../http";
import type { PostingServices } from "../posting";

import { getLedgerContext, postedBill, taxRates, vendorExternalIds } from "./backend";
import { quickbooks } from "./quickbooks";
import { LedgerError, type LedgerAdapter, type LedgerProvider } from "./types";
import { xero } from "./xero";

export function adapterFor(provider: LedgerProvider): LedgerAdapter {
  return provider === "xero" ? xero : quickbooks;
}

export async function postingServices(userToken: string, qbConnectionId: string): Promise<PostingServices> {
  const ledger = await getLedgerContext(userToken, qbConnectionId);
  let vendors: Promise<Map<string, string>> | null = null;
  let rates: Promise<Map<string, number>> | null = null;
  return {
    ledger,
    adapter: adapterFor(ledger.provider),
    vendorIds: () => (vendors ??= vendorExternalIds(userToken, qbConnectionId)),
    taxRates: () => (rates ??= taxRates(userToken, qbConnectionId)),
    bill: (invoiceId) => postedBill(userToken, qbConnectionId, invoiceId),
    renewLedger: () => getLedgerContext(userToken, qbConnectionId),
  };
}

/** A LedgerError as a response; anything else is the caller's to handle. */
export function ledgerErrorResponse(error: LedgerError): Response {
  const status = error.code === "not_configured" ? 503 : error.code === "permission" ? 403 : error.code === "reconnect" || error.code === "scope" ? 409 : error.code === "rate_limit" ? 429 : 502;
  return fail(status, error.message, { reason: error.code === "not_configured" ? "posting_not_configured" : error.code });
}
