// DELETE /api/bank-accounts/:id — stop syncing one account. When it was the
// last account of its bank login, the login is removed at Plaid too, which is
// what stops Plaid billing for it. Transactions already imported stay.
import { bankContext, errorResponse, fail, json } from "@/lib/bankFeeds/http";
import { plaidGateway } from "@/lib/bankFeeds/plaid";
import { getItemForAccount, listAccountViews, logEvent, markItemRemoved, removeAccount } from "@/lib/bankFeeds/store";
import { openAccessToken } from "@/lib/bankFeeds/sync";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bankContext(request, "connect");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  try {
    const found = await getItemForAccount(ctx.db, ctx.connection.id, id);
    if (!found) return fail(404, "That bank account isn't connected.");
    const remaining = await removeAccount(ctx.db, ctx.connection.id, id);
    let removedAtPlaid = false;
    if (remaining === 0) {
      const token = openAccessToken(ctx.config, found.item);
      if (token) {
        try {
          await plaidGateway(ctx.config).removeItem(token);
          removedAtPlaid = true;
        } catch (error) {
          // Already gone at Plaid is fine; anything else is logged and the
          // login is still removed here so it can never sync again.
          console.error("[bank] item remove failed", (error as Error).message);
        }
      }
      await markItemRemoved(ctx.db, found.item._id);
    }
    await logEvent(ctx.db, {
      qbConnectionId: ctx.connection.id,
      itemId: found.item._id,
      actor: ctx.caller.userId,
      action: "bank.account_disconnected",
      detail: { account: found.account.name, removedLogin: remaining === 0, removedAtPlaid },
    });
    return json({ accounts: await listAccountViews(ctx.db, ctx.connection.id) });
  } catch (error) {
    return errorResponse("disconnect", error);
  }
}
