// POST /api/bank-accounts/:id/relogin — Plaid Link update mode finished. The
// access token does not change (plaid.com/docs/link/update-mode/), so there is
// nothing to exchange: clear the "Needs re-login" state and sync.
import { bankContext, errorResponse, fail, json } from "@/lib/bankFeeds/http";
import { plaidGateway } from "@/lib/bankFeeds/plaid";
import { getItemForAccount, listAccountViews, logEvent, setItemStatus } from "@/lib/bankFeeds/store";
import { syncItem } from "@/lib/bankFeeds/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bankContext(request, "connect");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  try {
    const found = await getItemForAccount(ctx.db, ctx.connection.id, id);
    if (!found) return fail(404, "That bank account isn't connected.");
    await setItemStatus(ctx.db, found.item._id, "active", null);
    await logEvent(ctx.db, { qbConnectionId: ctx.connection.id, itemId: found.item._id, actor: ctx.caller.userId, action: "bank.relogin" });
    const outcome = await syncItem(ctx.db, plaidGateway(ctx.config), ctx.config, found.item._id, ctx.caller.userId);
    return json({ outcome, accounts: await listAccountViews(ctx.db, ctx.connection.id) });
  } catch (error) {
    return errorResponse("relogin", error);
  }
}
