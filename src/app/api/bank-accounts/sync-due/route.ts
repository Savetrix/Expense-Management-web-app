// POST /api/bank-accounts/sync-due — the bank page's safety net for new lines
// (lib/bankFeeds/sync.ts syncDueItems): logins not synced for 15 minutes are
// synced, and a login that doesn't know this server's webhook is told it.
// Answer: { checked, synced, added, webhooksSet }.
import { bankContext, errorResponse, json } from "@/lib/bankFeeds/http";
import { plaidGateway } from "@/lib/bankFeeds/plaid";
import { syncDueItems } from "@/lib/bankFeeds/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const ctx = await bankContext(request, "view");
  if (ctx instanceof Response) return ctx;
  try {
    return json(await syncDueItems(ctx.db, plaidGateway(ctx.config), ctx.config, ctx.connection.id));
  } catch (error) {
    return errorResponse("sync due", error);
  }
}
