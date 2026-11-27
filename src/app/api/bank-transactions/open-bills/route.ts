// GET /api/bank-transactions/open-bills — bills in QuickBooks/Xero with money
// still owed, dated in the last year, including ones entered there by hand.
// The bank page offers them as match candidates under the same rules as
// ScanTrix bills. Answer: { bills: OpenBill[] } ([] when the provider can't say).
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { adapterFor, ledgerErrorResponse } from "@/lib/bankFeeds/ledger";
import { getLedgerContext } from "@/lib/bankFeeds/ledger/backend";
import { LedgerError } from "@/lib/bankFeeds/ledger/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  try {
    const ledger = await getLedgerContext(ctx.caller.accessToken, ctx.connection.id);
    const adapter = adapterFor(ledger.provider);
    return json({ bills: adapter.openBills ? await adapter.openBills(ledger) : [] });
  } catch (error) {
    if (error instanceof LedgerError) return ledgerErrorResponse(error);
    return errorResponse("open bills", error);
  }
}
