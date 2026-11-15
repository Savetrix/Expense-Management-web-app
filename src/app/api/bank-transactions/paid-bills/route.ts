// POST /api/bank-transactions/paid-bills — of the bills a bank line could be
// matched to, the ones with nothing left to pay in QuickBooks/Xero (paid
// there directly, or voided). The bank page stops offering them.
// Body: { billIds: string[] } (the provider's own bill ids). Answer: { paid: string[] }.
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { adapterFor, ledgerErrorResponse } from "@/lib/bankFeeds/ledger";
import { getLedgerContext } from "@/lib/bankFeeds/ledger/backend";
import { LedgerError } from "@/lib/bankFeeds/ledger/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BILLS = 2000;

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const billIds = Array.isArray(body?.billIds) ? body.billIds.filter((id: unknown): id is string => typeof id === "string" && id.length <= 64) : null;
  if (!billIds) return fail(400, "Send the bill ids to check.");
  if (billIds.length > MAX_BILLS) return fail(400, `At most ${MAX_BILLS} bills at a time.`);
  if (billIds.length === 0) return json({ paid: [] });
  try {
    const ledger = await getLedgerContext(ctx.caller.accessToken, ctx.connection.id);
    return json({ paid: await adapterFor(ledger.provider).paidBills(ledger, billIds) });
  } catch (error) {
    if (error instanceof LedgerError) return ledgerErrorResponse(error);
    return errorResponse("paid bills", error);
  }
}
