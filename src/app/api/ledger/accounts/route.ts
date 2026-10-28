// GET /api/ledger/accounts — the company's chart of accounts in QuickBooks/Xero,
// straight from the provider: bank and card accounts (to map bank accounts to)
// and income accounts (to code money coming in). The backend's GL list only
// has accounts a bill can post to.
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
    return json({ provider: ledger.provider, accounts: await adapterFor(ledger.provider).listAccounts(ledger) });
  } catch (error) {
    if (error instanceof LedgerError) return ledgerErrorResponse(error);
    return errorResponse("ledger accounts", error);
  }
}
