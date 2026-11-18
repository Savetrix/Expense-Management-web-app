// GET /api/ledger/accounts — the company's chart of accounts in QuickBooks/Xero,
// straight from the provider, every type: bank and card accounts (to map bank
// accounts to), and the full list a bank line can be coded to (every account
// except Bank ones, filtered on the page). ?refresh=1 reads it again now.
//
// Kept per company for a day (companyLists.ts), so suggestions can leave out
// Bank-type accounts. When this server can't reach QuickBooks/Xero directly,
// the backend's own list is kept instead (still marks Bank accounts) and the
// answer is the same error as before, so the page says posting is off here.
import { chartFor } from "@/lib/bankFeeds/companyLists";
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { ledgerErrorResponse } from "@/lib/bankFeeds/ledger";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  try {
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    const chart = await chartFor(ctx.db, ctx.caller.accessToken, ctx.connection.id, { force });
    if (chart.source !== "ledger") {
      if (chart.ledgerError) return ledgerErrorResponse(chart.ledgerError);
      return errorResponse("ledger accounts", new Error("no chart of accounts"));
    }
    return json({ provider: chart.provider, accounts: chart.accounts });
  } catch (error) {
    return errorResponse("ledger accounts", error);
  }
}
